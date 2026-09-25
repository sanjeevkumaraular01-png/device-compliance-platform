package activity

import (
	"context"
	"io"
	"log/slog"
	"math/rand"
	"os"
	"os/user"
	"path/filepath"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/ipc"
	"github.com/secureendpoint/agent/internal/model"
)

const (
	sampleEvery   = time.Second
	flushEvery    = 60 * time.Second
	domainMaxAge  = 2 * time.Minute // extension refreshes every 30 s
	maxBuffered   = 2000            // segments kept in memory while the service is unreachable
	reconnectWait = 10 * time.Second
)

// Helper runs in the signed-in user's session (`sem-agent user-helper`).
type Helper struct {
	log *slog.Logger

	mu      sync.Mutex
	pol     *model.WorkforcePolicy
	conn    io.Writer
	pending []model.ActivitySegment
	events  []model.SessionEvent
}

// NewHelper creates the helper.
func NewHelper(log *slog.Logger) *Helper { return &Helper{log: log} }

// CurrentUser returns DOMAIN\user (Windows) or the username.
func CurrentUser() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return os.Getenv("USER")
}

// Run samples until ctx is cancelled, reconnecting to the service as needed.
func (h *Helper) Run(ctx context.Context) error {
	go h.connectLoop(ctx)

	var (
		probe       Probe
		probeTitles bool
		builder     *Builder
		lastLocked  bool
		noticeDay   = readNoticeDay()
		nextShot    time.Time
	)
	tick := time.NewTicker(sampleEvery)
	defer tick.Stop()
	flush := time.NewTicker(flushEvery)
	defer flush.Stop()

	for {
		select {
		case <-ctx.Done():
			if builder != nil {
				h.queue(builder.Flush(), nil)
			}
			h.send(ctx)
			return nil
		case <-flush.C:
			if builder != nil {
				h.queue(builder.Flush(), nil)
			}
			h.send(ctx)
		case now := <-tick.C:
			pol := h.policy()
			if !ShouldTrack(pol, now) {
				if builder != nil { // tracking just stopped: close the open segment
					h.queue(builder.Flush(), nil)
					builder = nil
				}
				continue
			}
			if probe == nil || probeTitles != pol.CaptureWindowTitles {
				probe, probeTitles = NewProbe(pol.CaptureWindowTitles), pol.CaptureWindowTitles
			}
			idle := time.Duration(pol.IdleThresholdSec) * time.Second
			if builder == nil || builder.IdleThreshold != idle || builder.KeepTitles != pol.CaptureWindowTitles {
				if builder != nil {
					h.queue(builder.Flush(), nil)
				}
				builder = NewBuilder(idle, pol.CaptureWindowTitles)
			}

			s, err := probe.Sample(ctx)
			if err != nil {
				continue
			}
			if !pol.TrackApps {
				s.App = ""
			}
			if pol.TrackWebsites && IsBrowser(s.App) {
				if host, _ := ReadActiveDomain(domainMaxAge); host != "" {
					s.Domain = host
				}
			}
			builder.Add(s)

			if s.Locked != lastLocked {
				t := "UNLOCK"
				if s.Locked {
					t = "LOCK"
				}
				h.queue(nil, []model.SessionEvent{{Type: t, At: s.At.UTC().Format(time.RFC3339)}})
				lastLocked = s.Locked
			}
			active := !s.Locked && s.Idle < builder.IdleThreshold

			// Transparency: one visible notice per tracked day.
			if pol.ShowTrackingNotice && active {
				if day := now.Format("2006-01-02"); day != noticeDay {
					noticeDay = day
					writeNoticeDay(day)
					go ShowNotice(context.Background(), pol.NoticeText)
				}
			}

			// Opt-in screenshots: only while active and inside tracked hours.
			if pol.Screenshots.Enabled && active {
				interval := time.Duration(max(pol.Screenshots.IntervalMin, 5)) * time.Minute
				if nextShot.IsZero() {
					nextShot = now.Add(jitter(interval))
				} else if !now.Before(nextShot) {
					nextShot = now.Add(jitter(interval))
					go h.screenshot(ctx, pol.Screenshots.Blur, s.App)
				}
			} else if !pol.Screenshots.Enabled {
				nextShot = time.Time{}
			}
		}
	}
}

func jitter(d time.Duration) time.Duration {
	span := int64(d) * 2 / 5 // ±20 %
	return d - time.Duration(span/2) + time.Duration(rand.Int63n(span+1))
}

func (h *Helper) screenshot(ctx context.Context, blur bool, app string) {
	img, err := Capture(ctx)
	if err != nil {
		h.log.Warn("screenshot capture failed", "err", err.Error())
		return
	}
	jpg, _, _, err := PrepareScreenshot(img, blur)
	if err != nil {
		return
	}
	h.write(&ipc.Message{Type: ipc.TypeScreenshot, JPEG: jpg, CapturedAt: time.Now().UTC().Format(time.RFC3339), ActiveApp: app, Blurred: blur})
}

func (h *Helper) policy() *model.WorkforcePolicy {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.pol
}

func (h *Helper) queue(segs []model.ActivitySegment, evs []model.SessionEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pending = append(h.pending, segs...)
	if over := len(h.pending) - maxBuffered; over > 0 {
		h.pending = h.pending[over:] // keep the most recent data
	}
	h.events = append(h.events, evs...)
}

// send delivers buffered segments to the service; on failure they stay queued.
func (h *Helper) send(context.Context) {
	h.mu.Lock()
	if h.conn == nil || (len(h.pending) == 0 && len(h.events) == 0) {
		h.mu.Unlock()
		return
	}
	msg := &ipc.Message{Type: ipc.TypeSegments, Segments: h.pending, SessionEvents: h.events}
	w := ipc.NewWriter(h.conn)
	err := w.Write(msg)
	if err == nil {
		h.pending, h.events = nil, nil
	}
	h.mu.Unlock()
}

func (h *Helper) write(m *ipc.Message) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conn != nil {
		_ = ipc.NewWriter(h.conn).Write(m)
	}
}

// connectLoop keeps a connection to the service and applies policy pushes.
func (h *Helper) connectLoop(ctx context.Context) {
	for ctx.Err() == nil {
		c, err := ipc.Dial(ctx)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(reconnectWait):
			}
			continue
		}
		if err := ipc.NewWriter(c).Write(&ipc.Message{Type: ipc.TypeHello, User: CurrentUser()}); err != nil {
			c.Close()
			continue
		}
		h.mu.Lock()
		h.conn = c
		h.mu.Unlock()
		h.log.Info("connected to agent service")

		r := ipc.NewReader(c)
		for {
			m, err := r.Read()
			if err != nil {
				break
			}
			if m.Type == ipc.TypePolicy {
				h.mu.Lock()
				h.pol = m.Workforce
				h.mu.Unlock()
			}
		}
		h.mu.Lock()
		h.conn = nil
		h.pol = nil // no policy without the service: stop collecting
		h.mu.Unlock()
		c.Close()
		h.log.Info("disconnected from agent service")
	}
}

func noticeFile() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "SecureEndpoint", "notice-shown")
}

func readNoticeDay() string {
	if p := noticeFile(); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			return string(b)
		}
	}
	return ""
}

func writeNoticeDay(day string) {
	if p := noticeFile(); p != "" {
		_ = os.MkdirAll(filepath.Dir(p), 0o700)
		_ = os.WriteFile(p, []byte(day), 0o600)
	}
}
