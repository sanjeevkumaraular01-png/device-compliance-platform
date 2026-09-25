//go:build darwin

package activity

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

var hidIdleRe = regexp.MustCompile(`"HIDIdleTime"\s*=\s*(\d+)`)

type macProbe struct {
	in         inputTracker
	wantTitles bool
}

// NewProbe returns the macOS session probe. Window titles (which need the
// Accessibility permission) are only read when wantTitles is set.
func NewProbe(wantTitles bool) Probe { return &macProbe{wantTitles: wantTitles} }

func (p *macProbe) Sample(ctx context.Context) (Sample, error) {
	s := Sample{At: time.Now()}
	// HIDIdleTime (ns) from the HID system: time since last input, no content.
	if out, err := platform.Run(ctx, 3*time.Second, "ioreg", "-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"); err == nil {
		if m := hidIdleRe.FindStringSubmatch(out); m != nil {
			if ns, err := strconv.ParseInt(m[1], 10, 64); err == nil {
				idle := time.Duration(ns)
				lastInput := uint64(s.At.Add(-idle).Unix())
				s.Input, s.Idle = p.in.observe(lastInput, idle)
			}
		}
	}
	// Frontmost application (name only; needs no special permission).
	if out, err := platform.Run(ctx, 3*time.Second, "lsappinfo", "info", "-only", "name", "front"); err == nil {
		// Output looks like: "LSDisplayName"="Safari"
		if i := strings.LastIndex(out, "="); i >= 0 {
			s.App = strings.Trim(strings.TrimSpace(out[i+1:]), `"`)
		}
	}
	// Window title requires the Accessibility permission; degrade silently.
	if !p.wantTitles {
		return s, nil
	}
	if out, err := platform.Run(ctx, 3*time.Second, "osascript", "-e",
		`tell application "System Events" to tell (first process whose frontmost is true) to get name of front window`); err == nil {
		s.Title = strings.TrimSpace(out)
	}
	return s, nil
}
