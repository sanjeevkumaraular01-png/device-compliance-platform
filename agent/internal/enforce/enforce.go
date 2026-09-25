// Package enforce applies the device policy to the OS: screen lock, automatic
// updates and firewall. USB rules live in package usb; blacklisted software
// in package software. Every action is idempotent: current state is read first
// and changed only when the policy requires it.
package enforce

import (
	"context"
	"log/slog"

	"github.com/secureendpoint/agent/internal/model"
)

// Result describes one enforcement action.
type Result struct {
	Setting string `json:"setting"`
	Changed bool   `json:"changed"`
	Skipped bool   `json:"skipped,omitempty"`
	Detail  string `json:"detail,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Apply enforces the policy and returns per-setting results.
func Apply(ctx context.Context, log *slog.Logger, pol *model.AgentPolicy, sec *model.SecurityStatus) []Result {
	if pol == nil {
		return nil
	}
	var results []Result
	add := func(r Result) {
		results = append(results, r)
		attrs := []any{"setting", r.Setting, "changed", r.Changed}
		if r.Detail != "" {
			attrs = append(attrs, "detail", r.Detail)
		}
		switch {
		case r.Error != "":
			log.Warn("policy enforcement failed", append(attrs, "err", r.Error)...)
		case r.Changed:
			log.Info("policy enforced", attrs...)
		default:
			log.Debug("policy already satisfied", attrs...)
		}
	}
	if pol.ScreenLock.Enabled {
		add(screenLock(ctx, log, pol.ScreenLock))
	}
	if pol.Updates.AutoUpdateEnabled {
		add(autoUpdate(ctx, log))
	}
	if pol.Security.RequireFirewall {
		fwState := model.StateUnknown
		if sec != nil {
			fwState = sec.FirewallState
		}
		add(firewall(ctx, log, fwState))
	}
	return results
}

func errResult(setting string, err error) Result {
	return Result{Setting: setting, Error: err.Error()}
}

// timeoutOrDefault returns a sane screen-lock timeout.
func timeoutOrDefault(sec int) int {
	if sec <= 0 {
		return 900
	}
	return sec
}
