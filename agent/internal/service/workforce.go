package service

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/api"
	"github.com/secureendpoint/agent/internal/ipc"
	"github.com/secureendpoint/agent/internal/model"
)

// workforceHub relays activity from per-user helpers (local IPC) to the
// server. The helpers never see the agent token.
type workforceHub struct {
	a *Agent

	mu        sync.Mutex
	pol       *model.WorkforcePolicy
	polJSON   string
	conns     map[net.Conn]*helperConn
	lastBatch time.Time
}

type helperConn struct {
	user string
	w    *ipc.Writer
	mu   sync.Mutex
}

func newWorkforceHub(a *Agent) *workforceHub {
	return &workforceHub{a: a, conns: map[net.Conn]*helperConn{}}
}

// SetPolicy stores the latest workforce block and pushes it to helpers when it
// changed. Called on every heartbeat (clockedOut / currentTask change without
// a policy version bump).
func (h *workforceHub) SetPolicy(p *model.WorkforcePolicy) {
	b, _ := json.Marshal(p)
	h.mu.Lock()
	if string(b) == h.polJSON {
		h.mu.Unlock()
		return
	}
	h.pol, h.polJSON = p, string(b)
	conns := make([]*helperConn, 0, len(h.conns))
	for _, c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	for _, c := range conns {
		c.send(&ipc.Message{Type: ipc.TypePolicy, Workforce: p})
	}
}

// Status reports helper connections and the last relayed batch (for `status`).
func (h *workforceHub) Status() (enabled bool, helpers int, last time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.pol != nil && h.pol.Enabled, len(h.conns), h.lastBatch
}

func (c *helperConn) send(m *ipc.Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.w.Write(m)
}

// Serve accepts helper connections until ctx is cancelled.
func (h *workforceHub) Serve(ctx context.Context) {
	l, err := ipc.Listen()
	if err != nil {
		h.a.log.Warn("workforce: cannot open local IPC endpoint; activity tracking unavailable", "addr", ipc.Address, "err", err.Error())
		return
	}
	go func() { <-ctx.Done(); l.Close() }()
	h.a.log.Info("workforce: listening for user helpers", "addr", ipc.Address)
	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return
			}
			time.Sleep(time.Second)
			continue
		}
		go h.handle(ctx, conn)
	}
}

func (h *workforceHub) handle(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	r := ipc.NewReader(conn)
	hello, err := r.Read()
	if err != nil || hello.Type != ipc.TypeHello {
		return
	}
	// Prefer the OS-verified peer identity; fall back to the reported one.
	user := ipc.PeerUser(conn)
	if user == "" {
		user = strings.TrimSpace(hello.User)
	}
	if user == "" || isServiceAccount(user) {
		return
	}
	hc := &helperConn{user: user, w: ipc.NewWriter(conn)}
	h.mu.Lock()
	h.conns[conn] = hc
	pol := h.pol
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.conns, conn)
		h.mu.Unlock()
	}()
	hc.send(&ipc.Message{Type: ipc.TypePolicy, Workforce: pol})

	for {
		m, err := r.Read()
		if err != nil {
			return
		}
		switch m.Type {
		case ipc.TypeSegments:
			h.relaySegments(ctx, user, m)
		case ipc.TypeScreenshot:
			h.relayScreenshot(ctx, user, m)
		}
	}
}

func (h *workforceHub) relaySegments(ctx context.Context, user string, m *ipc.Message) {
	if len(m.Segments) == 0 && len(m.SessionEvents) == 0 {
		return
	}
	h.mu.Lock()
	pol := h.pol
	h.mu.Unlock()
	if pol == nil || !pol.Enabled {
		return // tracking was switched off: drop, never store locally
	}
	segs := m.Segments
	if !pol.CaptureWindowTitles { // defence in depth: helpers should already drop them
		segs = make([]model.ActivitySegment, len(m.Segments))
		for i, s := range m.Segments {
			s.WindowTitle = ""
			segs[i] = s
		}
	}
	batch := model.ActivityBatch{OSUser: user, Network: localNetwork(), Segments: segs, SessionEvents: m.SessionEvents}
	if err := h.a.client.Deliver(ctx, h.a.spool, api.PathActivity, batch); err != nil {
		h.a.log.Warn("workforce: activity batch not delivered (spooled if retryable)", "err", err.Error())
	}
	h.mu.Lock()
	h.lastBatch = time.Now()
	h.mu.Unlock()
}

func (h *workforceHub) relayScreenshot(ctx context.Context, user string, m *ipc.Message) {
	h.mu.Lock()
	pol := h.pol
	h.mu.Unlock()
	if pol == nil || !pol.Enabled || !pol.Screenshots.Enabled || len(m.JPEG) == 0 {
		return
	}
	if pol.Screenshots.Blur && !m.Blurred {
		return // never upload an unblurred image when the policy requires blur
	}
	at, err := time.Parse(time.RFC3339, m.CapturedAt)
	if err != nil {
		at = time.Now()
	}
	up := api.ScreenshotUpload{JPEG: m.JPEG, CapturedAt: at, OSUser: user, ActiveApp: m.ActiveApp, Blurred: m.Blurred}
	if err := h.a.client.UploadScreenshot(ctx, up); err != nil {
		h.a.log.Warn("workforce: screenshot upload failed (dropped)", "err", err.Error())
	}
}

// isServiceAccount filters system identities that never represent an employee.
func isServiceAccount(u string) bool {
	l := strings.ToLower(u)
	for _, s := range []string{`nt authority\`, "root", "_", "system"} {
		if strings.HasPrefix(l, s) || l == strings.TrimSuffix(s, `\`) {
			return true
		}
	}
	return false
}

// localNetwork lists non-loopback IPs so the server can tag OFFICE vs REMOTE
// (the server also sees the public egress IP of each request).
func localNetwork() *model.ActivityNetwork {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && !ipn.IP.IsLinkLocalUnicast() {
			ips = append(ips, ipn.IP.String())
		}
	}
	return &model.ActivityNetwork{IPs: ips}
}
