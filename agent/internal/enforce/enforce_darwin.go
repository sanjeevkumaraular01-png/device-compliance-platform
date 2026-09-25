//go:build darwin

package enforce

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// screenLock: macOS only honours screen-saver / password-on-wake settings
// delivered through a configuration profile (com.apple.screensaver payload)
// or set by the user. A root daemon cannot set another user's password delay
// without their password, so the agent reports the requirement instead.
func screenLock(ctx context.Context, log *slog.Logger, p model.ScreenLockPolicy) Result {
	return Result{Setting: "screenLock", Skipped: true,
		Detail: fmt.Sprintf("requires MDM configuration profile (com.apple.screensaver idleTime=%d askForPassword=1); see packaging/macos/sem-usb-restrictions.mobileconfig", timeoutOrDefault(p.TimeoutSec))}
}

func autoUpdate(ctx context.Context, log *slog.Logger) Result {
	r := Result{Setting: "autoUpdate"}
	const domain = "/Library/Preferences/com.apple.SoftwareUpdate"
	for _, key := range []string{"AutomaticCheckEnabled", "AutomaticDownload", "CriticalUpdateInstall", "ConfigDataInstall"} {
		cur, _ := platform.Run(ctx, 10*time.Second, "defaults", "read", domain, key)
		if strings.TrimSpace(cur) == "1" {
			continue
		}
		if out, err := platform.RunCombined(ctx, 10*time.Second, nil, "defaults", "write", domain, key, "-bool", "true"); err != nil {
			return errResult(r.Setting, fmt.Errorf("defaults write %s: %v %s", key, err, out))
		}
		r.Changed = true
	}
	if r.Changed {
		_, _ = platform.RunCombined(ctx, 30*time.Second, nil, "softwareupdate", "--schedule", "on")
	}
	r.Detail = "automatic check/download/security installs enabled"
	return r
}

func firewall(ctx context.Context, log *slog.Logger, state string) Result {
	r := Result{Setting: "firewall"}
	if state == model.StateEnabled {
		r.Detail = "application firewall already on"
		return r
	}
	out, err := platform.RunCombined(ctx, 30*time.Second, nil, "/usr/libexec/ApplicationFirewall/socketfilterfw", "--setglobalstate", "on")
	if err != nil {
		return errResult(r.Setting, fmt.Errorf("%v %s", err, out))
	}
	r.Changed, r.Detail = true, "application firewall enabled"
	return r
}
