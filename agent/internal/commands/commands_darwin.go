//go:build darwin

package commands

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

// lockScreen puts the display to sleep; with "require password after sleep"
// (default on modern macOS) this locks the session.
func lockScreen(ctx context.Context, log *slog.Logger) (string, error) {
	return platform.RunCombined(ctx, 30*time.Second, nil, "pmset", "displaysleepnow")
}

func restart(ctx context.Context, log *slog.Logger, delaySec int) (string, error) {
	minutes := (restartDelay(delaySec) + 59) / 60
	log.Warn("scheduling restart", "minutes", minutes)
	return platform.RunCombined(ctx, 30*time.Second, nil, "shutdown", "-r", "+"+strconv.Itoa(minutes))
}

func enableEncryption(ctx context.Context, log *slog.Logger) (string, map[string]any, error) {
	out, _ := platform.RunCombined(ctx, 30*time.Second, nil, "fdesetup", "status")
	if strings.Contains(out, "FileVault is On") {
		return out, map[string]any{"alreadyEnabled": true}, nil
	}
	return out, map[string]any{"supported": false, "instructions": []string{
		"FileVault requires credentials of a Secure Token user and cannot be enabled silently by a daemon.",
		"Option 1 (recommended): deploy a FileVault configuration profile (com.apple.MCX.FileVault2 with Defer=true and FDERecoveryKeyEscrow) from your MDM; the user is prompted at next logout.",
		"Option 2: the user runs 'sudo fdesetup enable -user <shortname>' and stores the personal recovery key in the IT vault.",
	}}, errors.New("FileVault cannot be enabled without user credentials; see data.instructions")
}

func installPatches(ctx context.Context, log *slog.Logger, req PatchRequest) (string, map[string]any, error) {
	ids, rejected := SafeArgs(req.PatchIDs)
	data := map[string]any{}
	if len(rejected) > 0 {
		data["rejectedPatchIds"] = rejected
	}
	args := []string{"--install"}
	if len(ids) > 0 {
		args = append(args, ids...)
	} else if len(req.PatchIDs) > 0 {
		return "", data, errors.New("no valid patch ids")
	} else {
		args = append(args, "--all")
	}
	if req.Reboot == "if-required" {
		args = append(args, "--restart")
	}
	args = append(args, "--agree-to-license")
	out, err := platform.RunCombined(ctx, 3*time.Hour, nil, "softwareupdate", args...)
	data["rebootRequired"] = strings.Contains(strings.ToLower(out), "restart")
	return out, data, err
}
