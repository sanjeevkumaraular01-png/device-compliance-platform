//go:build linux

package commands

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/platform"
)

func lockScreen(ctx context.Context, log *slog.Logger) (string, error) {
	return platform.RunCombined(ctx, 30*time.Second, nil, "loginctl", "lock-sessions")
}

func restart(ctx context.Context, log *slog.Logger, delaySec int) (string, error) {
	d := restartDelay(delaySec)
	minutes := (d + 59) / 60
	log.Warn("scheduling restart", "minutes", minutes)
	return platform.RunCombined(ctx, 30*time.Second, nil, "shutdown", "-r", "+"+strconv.Itoa(minutes), "SecureEndpoint: restart requested by IT")
}

func enableEncryption(ctx context.Context, log *slog.Logger) (string, map[string]any, error) {
	return "", map[string]any{"supported": false},
		errors.New("not supported on Linux: LUKS full-disk encryption must be configured at OS installation time (or re-provision the device with an encrypted root)")
}

var aptEnv = []string{"DEBIAN_FRONTEND=noninteractive", "LANG=C", "NEEDRESTART_MODE=a"}
var dpkgOpts = []string{"-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"}

func installPatches(ctx context.Context, log *slog.Logger, req PatchRequest) (string, map[string]any, error) {
	const t = 2 * time.Hour
	ids, rejected := SafeArgs(req.PatchIDs)
	data := map[string]any{}
	if len(rejected) > 0 {
		data["rejectedPatchIds"] = rejected
	}
	var out string
	var err error
	switch {
	case platform.HasCommand("apt-get"):
		if o, e := platform.RunCombined(ctx, 10*time.Minute, aptEnv, "apt-get", "update"); e != nil {
			return o, data, fmt.Errorf("apt-get update: %w", e)
		}
		var pkgs []string
		for _, id := range ids {
			if pkg, _, ok := collector.ParseAptPatchID(id); ok {
				pkgs = append(pkgs, pkg)
			} else {
				pkgs = append(pkgs, id)
			}
		}
		switch {
		case len(pkgs) > 0:
			args := append([]string{"install", "-y", "--only-upgrade"}, dpkgOpts...)
			out, err = platform.RunCombined(ctx, t, aptEnv, "apt-get", append(args, pkgs...)...)
			data["packages"] = pkgs
		case securityOnly(req.Severities) && platform.HasCommand("unattended-upgrade"):
			out, err = platform.RunCombined(ctx, t, aptEnv, "unattended-upgrade", "-v")
		default:
			args := append([]string{"upgrade", "-y"}, dpkgOpts...)
			out, err = platform.RunCombined(ctx, t, aptEnv, "apt-get", args...)
		}
	case platform.HasCommand("dnf") || platform.HasCommand("yum"):
		bin := "dnf"
		if !platform.HasCommand("dnf") {
			bin = "yum"
		}
		args := []string{"-y", "update"}
		switch {
		case len(ids) > 0:
			for _, id := range ids {
				args = append(args, "--advisory="+id)
			}
		case len(req.Severities) > 0:
			args = append(args, "--security")
			for _, s := range req.Severities {
				if sev := dnfSeverity(s); sev != "" {
					args = append(args, "--sec-severity="+sev)
				}
			}
		}
		out, err = platform.RunCombined(ctx, t, []string{"LANG=C"}, bin, args...)
	case platform.HasCommand("zypper"):
		args := []string{"--non-interactive", "patch"}
		if securityOnly(req.Severities) {
			args = append(args, "--category", "security")
		}
		out, err = platform.RunCombined(ctx, t, nil, "zypper", args...)
		if platform.ExitCode(err) == 102 || platform.ExitCode(err) == 103 { // reboot / restart needed
			err = nil
		}
	default:
		return "", data, errors.New("no supported package manager found")
	}
	out = tail(out, 200)
	if err != nil {
		return out, data, err
	}
	reboot := platform.Exists("/var/run/reboot-required") || platform.Exists("/run/reboot-required")
	if !reboot && platform.HasCommand("needs-restarting") {
		_, e := platform.Run(ctx, time.Minute, "needs-restarting", "-r")
		reboot = platform.ExitCode(e) == 1
	}
	data["rebootRequired"] = reboot
	if reboot && req.Reboot == "if-required" {
		if o, e := restart(ctx, log, 300); e == nil {
			data["rebootScheduled"] = true
			out += "\n" + o
		}
	}
	return out, data, nil
}

func securityOnly(sev []string) bool {
	if len(sev) == 0 {
		return false
	}
	for _, s := range sev {
		switch strings.ToUpper(s) {
		case "CRITICAL", "IMPORTANT":
		default:
			return false
		}
	}
	return true
}

func dnfSeverity(s string) string {
	switch strings.ToUpper(s) {
	case "CRITICAL":
		return "Critical"
	case "IMPORTANT":
		return "Important"
	case "MODERATE":
		return "Moderate"
	case "LOW":
		return "Low"
	}
	return ""
}

func tail(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
