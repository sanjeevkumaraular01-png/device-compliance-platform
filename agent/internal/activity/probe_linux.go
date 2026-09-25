//go:build linux

package activity

import (
	"context"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

var (
	activeWinRe = regexp.MustCompile(`window id # (0x[0-9a-fA-F]+)`)
	pidRe       = regexp.MustCompile(`_NET_WM_PID\(CARDINAL\) = (\d+)`)
	wmNameRe    = regexp.MustCompile(`(?:_NET_WM_NAME|WM_NAME)\([^)]*\) = "(.*)"`)
)

type linuxProbe struct {
	in         inputTracker
	wantTitles bool
}

// NewProbe returns the Linux session probe (X11 tools when available,
// logind idle hint otherwise; on Wayland the foreground app is unknown).
func NewProbe(wantTitles bool) Probe { return &linuxProbe{wantTitles: wantTitles} }

func (p *linuxProbe) Sample(ctx context.Context) (Sample, error) {
	s := Sample{At: time.Now()}
	x11 := os.Getenv("DISPLAY") != ""

	if x11 && platform.HasCommand("xprintidle") {
		if out, err := platform.Run(ctx, 2*time.Second, "xprintidle"); err == nil {
			if ms, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64); err == nil {
				idle := time.Duration(ms) * time.Millisecond
				s.Input, s.Idle = p.in.observe(uint64(s.At.Add(-idle).Unix()), idle)
			}
		}
	} else if id := os.Getenv("XDG_SESSION_ID"); id != "" {
		if out, err := platform.Run(ctx, 2*time.Second, "loginctl", "show-session", id, "-p", "IdleHint", "-p", "IdleSinceHint", "-p", "LockedHint"); err == nil {
			props := map[string]string{}
			for _, l := range strings.Split(out, "\n") {
				if k, v, ok := strings.Cut(strings.TrimSpace(l), "="); ok {
					props[k] = v
				}
			}
			s.Locked = props["LockedHint"] == "yes"
			if props["IdleHint"] == "yes" {
				if us, err := strconv.ParseInt(props["IdleSinceHint"], 10, 64); err == nil && us > 0 {
					since := time.UnixMicro(us)
					s.Idle = s.At.Sub(since)
					s.Input, _ = p.in.observe(uint64(since.Unix()), s.Idle)
				}
			} else {
				s.Input, _ = p.in.observe(uint64(s.At.Unix()), 0)
			}
		}
	}

	if x11 && platform.HasCommand("xprop") {
		out, err := platform.Run(ctx, 2*time.Second, "xprop", "-root", "_NET_ACTIVE_WINDOW")
		if err == nil {
			if m := activeWinRe.FindStringSubmatch(out); m != nil && m[1] != "0x0" {
				if win, err := platform.Run(ctx, 2*time.Second, "xprop", "-id", m[1], "_NET_WM_PID", "_NET_WM_NAME", "WM_NAME"); err == nil {
					if pm := pidRe.FindStringSubmatch(win); pm != nil {
						if comm, err := os.ReadFile("/proc/" + pm[1] + "/comm"); err == nil {
							s.App = strings.TrimSpace(string(comm))
						}
					}
					if tm := wmNameRe.FindStringSubmatch(win); tm != nil && p.wantTitles {
						s.Title = tm[1]
					}
				}
			}
		}
	}
	return s, nil
}
