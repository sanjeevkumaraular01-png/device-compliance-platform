//go:build darwin || linux

package activity

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func autostartPath() string {
	if runtime.GOOS == "darwin" {
		return "/Library/LaunchAgents/com.secureendpoint.agent.user.plist"
	}
	return "/etc/xdg/autostart/sem-agent-user.desktop"
}

func nativeHostDirs() []string {
	if runtime.GOOS == "darwin" {
		return []string{
			"/Library/Google/Chrome/NativeMessagingHosts",
			"/Library/Microsoft/Edge/NativeMessagingHosts",
		}
	}
	return []string{
		"/etc/opt/chrome/native-messaging-hosts",
		"/etc/chromium/native-messaging-hosts",
		"/etc/opt/edge/native-messaging-hosts",
	}
}

func autostartContent(exe string) string {
	if runtime.GOOS == "darwin" {
		return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.secureendpoint.agent.user</string>
  <key>ProgramArguments</key><array><string>%s</string><string>user-helper</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`, exe)
	}
	return fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=SecureEndpoint activity helper
Comment=Work activity tracking (apps, website names, active time; never typed content)
Exec=%s user-helper
X-GNOME-Autostart-enabled=true
NoDisplay=true
`, exe)
}

// InstallIntegration registers the per-user helper for every graphical logon
// and the browser native messaging host.
func InstallIntegration(exe string, extensionIDs []string) error {
	p := autostartPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(p, []byte(autostartContent(exe)), 0o644); err != nil {
		return err
	}
	manifest, err := NativeHostManifestJSON(exe, extensionIDs)
	if err != nil {
		return err
	}
	for _, dir := range nativeHostDirs() {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		_ = os.WriteFile(filepath.Join(dir, NativeHostName+".json"), manifest, 0o644)
	}
	return nil
}

// RemoveIntegration undoes InstallIntegration.
func RemoveIntegration() error {
	_ = os.Remove(autostartPath())
	for _, dir := range nativeHostDirs() {
		_ = os.Remove(filepath.Join(dir, NativeHostName+".json"))
	}
	return nil
}
