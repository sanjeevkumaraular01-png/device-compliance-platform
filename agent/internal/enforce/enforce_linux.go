//go:build linux

package enforce

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

const (
	dconfProfile   = "/etc/dconf/profile/user"
	dconfKeyfile   = "/etc/dconf/db/local.d/00-sem-screenlock"
	dconfLocksFile = "/etc/dconf/db/local.d/locks/00-sem-screenlock"
)

// ScreenLockKeyfile renders the dconf system-db keyfile for GNOME.
func ScreenLockKeyfile(p model.ScreenLockPolicy) (string, string) {
	timeout := timeoutOrDefault(p.TimeoutSec)
	lock := "true"
	if !p.RequirePassword {
		lock = "false"
	}
	keyfile := fmt.Sprintf(`# Managed by SecureEndpoint agent
[org/gnome/desktop/session]
idle-delay=uint32 %d

[org/gnome/desktop/screensaver]
idle-activation-enabled=true
lock-enabled=%s
lock-delay=uint32 0
`, timeout, lock)
	locks := `# Managed by SecureEndpoint agent
/org/gnome/desktop/session/idle-delay
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/lock-delay
`
	return keyfile, locks
}

func screenLock(ctx context.Context, log *slog.Logger, p model.ScreenLockPolicy) Result {
	r := Result{Setting: "screenLock"}
	if !platform.HasCommand("dconf") {
		r.Skipped, r.Detail = true, "dconf not installed (no GNOME desktop); nothing to enforce"
		return r
	}
	// Ensure the user profile consults the local system database.
	prof, _ := os.ReadFile(dconfProfile)
	ps := string(prof)
	if !strings.Contains(ps, "system-db:local") {
		if strings.TrimSpace(ps) == "" {
			ps = "user-db:user\n"
		}
		if !strings.HasSuffix(ps, "\n") {
			ps += "\n"
		}
		ps += "system-db:local\n"
		if _, err := platform.WriteFileIfChanged(dconfProfile, []byte(ps), 0o644); err != nil {
			return errResult(r.Setting, err)
		}
		r.Changed = true
	}
	keyfile, locks := ScreenLockKeyfile(p)
	c1, err := platform.WriteFileIfChanged(dconfKeyfile, []byte(keyfile), 0o644)
	if err != nil {
		return errResult(r.Setting, err)
	}
	c2, err := platform.WriteFileIfChanged(dconfLocksFile, []byte(locks), 0o644)
	if err != nil {
		return errResult(r.Setting, err)
	}
	r.Changed = r.Changed || c1 || c2
	if r.Changed {
		if out, err := platform.RunCombined(ctx, 60*time.Second, nil, "dconf", "update"); err != nil {
			return errResult(r.Setting, fmt.Errorf("dconf update: %v %s", err, out))
		}
	}
	r.Detail = fmt.Sprintf("GNOME idle-delay=%ds lock-enabled=%v (locked system-wide)", timeoutOrDefault(p.TimeoutSec), p.RequirePassword)
	return r
}

const aptAutoUpgrades = `// Managed by SecureEndpoint agent
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
`

func autoUpdate(ctx context.Context, log *slog.Logger) Result {
	r := Result{Setting: "autoUpdate"}
	switch {
	case platform.HasCommand("dpkg"):
		if !platform.Exists("/usr/bin/unattended-upgrade") {
			out, err := platform.RunCombined(ctx, 10*time.Minute, []string{"DEBIAN_FRONTEND=noninteractive"}, "apt-get", "install", "-y", "unattended-upgrades")
			if err != nil {
				return errResult(r.Setting, fmt.Errorf("install unattended-upgrades: %v %s", err, lastLines(out, 5)))
			}
			r.Changed = true
		}
		c, err := platform.WriteFileIfChanged("/etc/apt/apt.conf.d/20auto-upgrades", []byte(aptAutoUpgrades), 0o644)
		if err != nil {
			return errResult(r.Setting, err)
		}
		r.Changed = r.Changed || c
		r.Detail = "unattended-upgrades enabled"
	case platform.HasCommand("dnf"):
		if !platform.Exists("/usr/lib/systemd/system/dnf-automatic-install.timer") && !platform.Exists("/usr/lib/systemd/system/dnf-automatic.timer") {
			out, err := platform.RunCombined(ctx, 10*time.Minute, nil, "dnf", "install", "-y", "dnf-automatic")
			if err != nil {
				return errResult(r.Setting, fmt.Errorf("install dnf-automatic: %v %s", err, lastLines(out, 5)))
			}
			r.Changed = true
		}
		unit := "dnf-automatic-install.timer"
		if !platform.Exists("/usr/lib/systemd/system/" + unit) {
			unit = "dnf-automatic.timer"
		}
		if out, _ := platform.Run(ctx, 10*time.Second, "systemctl", "is-enabled", unit); strings.TrimSpace(out) != "enabled" {
			if out, err := platform.RunCombined(ctx, 60*time.Second, nil, "systemctl", "enable", "--now", unit); err != nil {
				return errResult(r.Setting, fmt.Errorf("enable %s: %v %s", unit, err, out))
			}
			r.Changed = true
		}
		r.Detail = unit + " enabled"
	default:
		r.Skipped, r.Detail = true, "unsupported package manager"
	}
	return r
}

func firewall(ctx context.Context, log *slog.Logger, state string) Result {
	r := Result{Setting: "firewall"}
	if state == model.StateEnabled {
		r.Detail = "firewall already active"
		return r
	}
	switch {
	case platform.HasCommand("ufw"):
		// Never lock out remote administration: allow SSH before enabling.
		if platform.Exists("/usr/sbin/sshd") {
			_, _ = platform.RunCombined(ctx, 30*time.Second, nil, "ufw", "limit", "22/tcp")
		}
		out, err := platform.RunCombined(ctx, 60*time.Second, nil, "ufw", "--force", "enable")
		if err != nil {
			return errResult(r.Setting, fmt.Errorf("ufw enable: %v %s", err, out))
		}
		r.Changed, r.Detail = true, "ufw enabled (SSH rate-limited/allowed)"
	case platform.HasCommand("firewall-cmd") || platform.Exists("/usr/lib/systemd/system/firewalld.service"):
		out, err := platform.RunCombined(ctx, 60*time.Second, nil, "systemctl", "enable", "--now", "firewalld")
		if err != nil {
			return errResult(r.Setting, fmt.Errorf("enable firewalld: %v %s", err, out))
		}
		r.Changed, r.Detail = true, "firewalld enabled (default zone keeps ssh open)"
	default:
		r.Skipped, r.Detail = true, "no supported firewall frontend (ufw/firewalld) installed"
	}
	return r
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, " | ")
}
