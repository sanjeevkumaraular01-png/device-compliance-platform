//go:build darwin

package software

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// uninstall deletes an application bundle. Only third-party bundles located
// directly in /Applications are removed (never Apple / system apps, never
// moved to a user's Trash).
func uninstall(ctx context.Context, item model.Software) (string, error) {
	p := filepath.Clean(item.InstallLocation)
	if !strings.HasPrefix(p, "/Applications/") || !strings.HasSuffix(p, ".app") || strings.Count(strings.TrimPrefix(p, "/Applications/"), "/") > 1 {
		return "", fmt.Errorf("%w: %q is not an application bundle in /Applications", ErrNoSilentUninstall, p)
	}
	if item.Source == "system" || strings.EqualFold(item.Publisher, "Apple") {
		return "", ErrProtected
	}
	st, err := os.Lstat(p)
	if err != nil {
		return "", err
	}
	if st.Mode()&os.ModeSymlink != 0 || !st.IsDir() {
		return "", fmt.Errorf("%q is not a directory bundle", p)
	}
	// Quit the app if it is running (best effort).
	name := strings.TrimSuffix(filepath.Base(p), ".app")
	_, _ = platform.Run(ctx, 10*time.Second, "pkill", "-x", name)
	if err := os.RemoveAll(p); err != nil {
		return "", err
	}
	return "removed " + p, nil
}
