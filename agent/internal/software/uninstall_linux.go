//go:build linux

package software

import (
	"context"
	"fmt"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

var aptEnv = []string{"DEBIAN_FRONTEND=noninteractive", "LANG=C"}

func uninstall(ctx context.Context, item model.Software) (string, error) {
	pkg := item.PackageID
	if pkg == "" {
		pkg = item.Name
	}
	const t = 20 * time.Minute
	switch item.Source {
	case "snap":
		return platform.RunCombined(ctx, t, nil, "snap", "remove", pkg)
	case "flatpak":
		return platform.RunCombined(ctx, t, nil, "flatpak", "uninstall", "-y", "--noninteractive", pkg)
	case "rpm":
		if platform.HasCommand("dnf") {
			return platform.RunCombined(ctx, t, nil, "dnf", "remove", "-y", pkg)
		}
		if platform.HasCommand("zypper") {
			return platform.RunCombined(ctx, t, nil, "zypper", "--non-interactive", "remove", pkg)
		}
		return platform.RunCombined(ctx, t, nil, "yum", "remove", "-y", pkg)
	case "dpkg", "system":
		if platform.HasCommand("apt-get") {
			return platform.RunCombined(ctx, t, aptEnv, "apt-get", "remove", "-y", "-o", "Dpkg::Options::=--force-confold", pkg)
		}
		if platform.HasCommand("dnf") {
			return platform.RunCombined(ctx, t, nil, "dnf", "remove", "-y", pkg)
		}
	}
	return "", fmt.Errorf("%w: unknown package source %q", ErrNoSilentUninstall, item.Source)
}
