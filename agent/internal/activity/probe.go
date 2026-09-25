package activity

import (
	"context"
	"path/filepath"
	"strings"
	"time"
)

// Probe samples the interactive session of the user running the helper.
// Implementations never read keystrokes: input presence is derived from the
// OS "last input time", which carries no content.
type Probe interface {
	// Sample returns the current foreground app/title, idle time and whether
	// input happened since the previous call.
	Sample(ctx context.Context) (Sample, error)
}

// normalizeApp turns an executable path into a short app name ("chrome").
func normalizeApp(exe string) string {
	base := filepath.Base(strings.ReplaceAll(exe, "\\", "/"))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if base == "." || base == "/" {
		return ""
	}
	return base
}

// inputTracker converts a monotonically increasing "last input" marker into
// idle duration + "input happened since last sample".
type inputTracker struct {
	last    uint64
	started bool
}

func (t *inputTracker) observe(lastInput uint64, idle time.Duration) (bool, time.Duration) {
	input := t.started && lastInput != t.last
	t.last, t.started = lastInput, true
	if idle < 0 {
		idle = 0
	}
	return input, idle
}
