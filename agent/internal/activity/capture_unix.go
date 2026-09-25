//go:build darwin || linux

package activity

import (
	"context"
	"errors"
	"image"
	_ "image/jpeg" // decoders for the capture tools' output
	_ "image/png"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

// Capture grabs the screen with the OS screenshot tool (keeps CGO_ENABLED=0
// builds possible). macOS needs the Screen Recording permission for the helper.
func Capture(ctx context.Context) (image.Image, error) {
	dir, err := os.MkdirTemp("", "sem-shot-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	out := filepath.Join(dir, "shot.png")

	var tried []string
	run := func(name string, args ...string) bool {
		if !platform.HasCommand(name) {
			return false
		}
		tried = append(tried, name)
		_, err := platform.Run(ctx, 20*time.Second, name, args...)
		return err == nil && platform.Exists(out)
	}
	ok := false
	if runtime.GOOS == "darwin" {
		ok = run("screencapture", "-x", "-t", "png", out)
	} else {
		ok = (os.Getenv("WAYLAND_DISPLAY") != "" && run("grim", out)) ||
			run("gnome-screenshot", "-f", out) ||
			run("import", "-window", "root", out)
	}
	if !ok {
		if len(tried) == 0 {
			return nil, errors.New("no screenshot tool available (install grim, gnome-screenshot or imagemagick)")
		}
		return nil, errors.New("screen capture failed")
	}
	f, err := os.Open(out)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}
