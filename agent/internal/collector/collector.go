// Package collector gathers hardware, security posture, software inventory and
// patch state. Each OS has its own implementation (collector_<os>.go). Every
// probe is bounded by a timeout and degrades to UNKNOWN / omitted instead of
// failing the whole report.
package collector

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// Options tunes collection.
type Options struct {
	SkipSoftware  bool
	SkipPatches   bool
	PatchCacheTTL time.Duration // missing-patch scans are expensive (default 4h)
	PatchTimeout  time.Duration // default 5m
	Logger        *slog.Logger
}

// Collector gathers device state.
type Collector struct {
	opts Options
	log  *slog.Logger

	mu        sync.Mutex
	patches   []model.Patch
	patchesAt time.Time
}

// New returns a collector.
func New(opts Options) *Collector {
	if opts.PatchCacheTTL <= 0 {
		opts.PatchCacheTTL = 4 * time.Hour
	}
	if opts.PatchTimeout <= 0 {
		opts.PatchTimeout = 5 * time.Minute
	}
	l := opts.Logger
	if l == nil {
		l = slog.Default()
	}
	return &Collector{opts: opts, log: l}
}

// Hardware collects HardwareInfo. serialNumber is always non-empty (falls
// back to a stable machine identifier).
func (c *Collector) Hardware(ctx context.Context) model.HardwareInfo {
	hw, _ := probeValue(ctx, c.log, "hardware", 90*time.Second, func(ctx context.Context) (model.HardwareInfo, error) {
		return collectHardware(ctx, c.log), nil
	})
	hw.Platform = Platform()
	if hw.OsArch == "" {
		hw.OsArch = archLabel()
	}
	fillNetwork(&hw)
	if hw.Hostname == "" {
		hw.Hostname = hostname()
	}
	if hw.DeviceName == "" {
		hw.DeviceName = hw.Hostname
	}
	if !validSerial(hw.SerialNumber) {
		if id := machineID(ctx); id != "" {
			hw.SerialNumber = "MID-" + id
		} else {
			hw.SerialNumber = "HOST-" + strings.ToUpper(hw.Hostname)
		}
	}
	if hw.DeviceType == "" {
		hw.DeviceType = model.DeviceOther
	}
	return hw
}

// Security collects the security posture.
func (c *Collector) Security(ctx context.Context) model.SecurityStatus {
	s, ok := probeValue(ctx, c.log, "security", 3*time.Minute, func(ctx context.Context) (model.SecurityStatus, error) {
		st := model.NewSecurityStatus()
		collectSecurity(ctx, c.log, &st)
		return st, nil
	})
	if !ok {
		s = model.NewSecurityStatus()
	}
	if len(s.Raw) == 0 {
		s.Raw = nil
	}
	return s
}

// Software collects the installed software inventory (sorted by name).
func (c *Collector) Software(ctx context.Context) []model.Software {
	items, _ := probeValue(ctx, c.log, "software", 3*time.Minute, func(ctx context.Context) ([]model.Software, error) {
		return collectSoftware(ctx, c.log)
	})
	return dedupeSoftware(items)
}

// Patches returns installed + missing patches. The missing-patch scan is
// cached for PatchCacheTTL unless force is set.
func (c *Collector) Patches(ctx context.Context, force bool) []model.Patch {
	c.mu.Lock()
	if !force && c.patches != nil && time.Since(c.patchesAt) < c.opts.PatchCacheTTL {
		p := c.patches
		c.mu.Unlock()
		return p
	}
	c.mu.Unlock()
	patches, ok := probeValue(ctx, c.log, "patches", c.opts.PatchTimeout, func(ctx context.Context) ([]model.Patch, error) {
		return collectPatches(ctx, c.log)
	})
	if patches == nil {
		patches = []model.Patch{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if ok || len(patches) > 0 {
		c.patches, c.patchesAt = patches, time.Now()
	} else if c.patches != nil {
		return c.patches // keep last good scan
	}
	return patches
}

// InvalidatePatches forces the next Patches call to rescan.
func (c *Collector) InvalidatePatches() {
	c.mu.Lock()
	c.patchesAt = time.Time{}
	c.mu.Unlock()
}

// Report collects everything.
func (c *Collector) Report(ctx context.Context) *model.Report {
	r := &model.Report{CollectedAt: model.Now(), Software: []model.Software{}, Patches: []model.Patch{}}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); r.Hardware = c.Hardware(ctx) }()
	go func() { defer wg.Done(); r.Security = c.Security(ctx) }()
	if !c.opts.SkipSoftware {
		wg.Add(1)
		go func() { defer wg.Done(); r.Software = c.Software(ctx) }()
	}
	if !c.opts.SkipPatches {
		wg.Add(1)
		go func() { defer wg.Done(); r.Patches = c.Patches(ctx, false) }()
	}
	wg.Add(1)
	go func() { defer wg.Done(); r.Services = c.Services(ctx) }()
	wg.Wait()
	return r
}

// Services collects the running OS services/daemons (best-effort).
func (c *Collector) Services(ctx context.Context) []model.Service {
	items, _ := probeValue(ctx, c.log, "services", 60*time.Second, func(ctx context.Context) ([]model.Service, error) {
		return collectServices(ctx, c.log), nil
	})
	return items
}

// LoggedInUser returns the interactive user (best effort).
func LoggedInUser(ctx context.Context) string {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return loggedInUser(cctx)
}

// Platform returns the OsPlatform enum for this build.
func Platform() string {
	switch runtime.GOOS {
	case "windows":
		return model.PlatformWindows
	case "darwin":
		return model.PlatformMacOS
	default:
		return model.PlatformLinux
	}
}

// probeValue runs fn with a timeout, recovering panics. On timeout or
// failure it returns whatever fn returned (zero value on timeout) and false.
// Values are handed over through a channel so a timed-out probe can never
// race with the caller.
func probeValue[T any](ctx context.Context, log *slog.Logger, name string, timeout time.Duration, fn func(context.Context) (T, error)) (T, bool) {
	type result struct {
		v   T
		err error
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	done := make(chan result, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				var zero T
				done <- result{zero, fmt.Errorf("panic: %v\n%s", r, debug.Stack())}
			}
		}()
		v, err := fn(cctx)
		done <- result{v, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			log.Debug("probe failed", "probe", name, "err", r.err.Error())
			return r.v, false
		}
		return r.v, true
	case <-cctx.Done():
		log.Warn("probe timed out", "probe", name, "timeout", timeout.String())
		var zero T
		return zero, false
	}
}

// step runs a sub-probe inside a platform collector (panic-safe, bounded).
// fn must only mutate state it owns; results should be applied by the
// returned closure, which runs on the caller goroutine only if fn completed.
func step(ctx context.Context, log *slog.Logger, name string, timeout time.Duration, fn func(context.Context) (func(), error)) {
	apply, _ := probeValue(ctx, log, name, timeout, fn)
	if apply != nil {
		apply()
	}
}

var invalidSerials = []string{
	"", "0", "none", "default string", "to be filled by o.e.m.", "system serial number",
	"not specified", "not applicable", "n/a", "na", "unknown", "123456789", "0123456789",
	"chassis serial number", "serial", "invalid", "oem", "xxxxxxxxxx",
}

func validSerial(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	for _, bad := range invalidSerials {
		if s == bad {
			return false
		}
	}
	return strings.Trim(s, "0 .-") != ""
}

func dedupeSoftware(items []model.Software) []model.Software {
	seen := map[string]bool{}
	out := make([]model.Software, 0, len(items))
	for _, it := range items {
		it.Name = strings.TrimSpace(it.Name)
		if it.Name == "" {
			continue
		}
		k := strings.ToLower(it.Name) + "\x00" + it.Version
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, it)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Version < out[j].Version
	})
	return out
}
