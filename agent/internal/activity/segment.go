// Package activity implements workforce activity tracking for the per-user
// helper (docs/WORKFORCE.md). Privacy rules enforced here:
//   - no keystroke content: only whether input happened in each 1 s sample;
//   - websites as hostnames only (see SanitizeDomain);
//   - window titles are dropped unless the policy allows them.
package activity

import (
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// Sample is one observation of the interactive session (taken every second).
type Sample struct {
	At     time.Time
	App    string        // foreground process name, e.g. "chrome", "Code"
	Title  string        // foreground window title (dropped unless allowed)
	Domain string        // hostname of the active browser tab, if known
	Idle   time.Duration // time since the last keyboard/mouse input
	Input  bool          // input happened since the previous sample
	Locked bool          // workstation locked / screensaver
}

const (
	// MaxSegment is the longest segment sent to the server.
	MaxSegment = 300 * time.Second
	// MinSegment drops alt-tab noise shorter than this.
	MinSegment = 2 * time.Second
	// sampleGap is treated as a break in observation (sleep, helper paused).
	sampleGap = 10 * time.Second
)

// Builder turns 1 s samples into segments: a new segment starts whenever the
// app, domain, title or active/idle state changes, or MaxSegment is reached.
type Builder struct {
	IdleThreshold time.Duration
	KeepTitles    bool

	cur      *model.ActivitySegment
	curStart time.Time
	curEnd   time.Time
	done     []model.ActivitySegment
}

// NewBuilder returns a Builder; idleThreshold <= 0 defaults to 5 minutes.
func NewBuilder(idleThreshold time.Duration, keepTitles bool) *Builder {
	if idleThreshold <= 0 {
		idleThreshold = 5 * time.Minute
	}
	return &Builder{IdleThreshold: idleThreshold, KeepTitles: keepTitles}
}

// Add records one sample.
func (b *Builder) Add(s Sample) {
	active := !s.Locked && s.Idle < b.IdleThreshold
	title := ""
	if b.KeepTitles && active {
		title = s.Title
	}
	app, domain := s.App, s.Domain
	if !active {
		// Idle time is not attributed to whatever window happened to be in front.
		app, domain, title = "", "", ""
	}

	if b.cur != nil {
		gap := s.At.Sub(b.curEnd)
		same := b.cur.Active == active && b.cur.App == app && b.cur.Domain == domain && b.cur.WindowTitle == title
		if gap > sampleGap || gap < 0 || !same || s.At.Sub(b.curStart) >= MaxSegment {
			b.close()
		}
	}
	if b.cur == nil {
		b.cur = &model.ActivitySegment{Active: active, App: app, Domain: domain, WindowTitle: title}
		b.curStart = s.At
	}
	b.curEnd = s.At.Add(time.Second)
	if s.Input && active {
		b.cur.InputEvents++
	}
}

// Flush closes the open segment and returns all completed segments.
func (b *Builder) Flush() []model.ActivitySegment {
	b.close()
	out := b.done
	b.done = nil
	return out
}

// Pending reports how many completed segments are waiting to be flushed.
func (b *Builder) Pending() int { return len(b.done) }

func (b *Builder) close() {
	if b.cur == nil {
		return
	}
	if b.curEnd.Sub(b.curStart) >= MinSegment {
		b.cur.StartedAt = b.curStart.UTC().Format(time.RFC3339)
		b.cur.EndedAt = b.curEnd.UTC().Format(time.RFC3339)
		b.done = append(b.done, *b.cur)
	}
	b.cur = nil
}
