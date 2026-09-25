package activity

import (
	"context"
	"runtime"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

// DefaultNotice is shown when the server sends no custom text.
const DefaultNotice = "Work activity tracking is on for your work hours (apps, website names and active time; never what you type). You can see your own data in the SecureEndpoint console under My Day."

// ShowNotice displays the transparency notice to the signed-in user.
// Best effort: failures are ignored (the console also shows a banner).
func ShowNotice(ctx context.Context, text string) {
	if strings.TrimSpace(text) == "" {
		text = DefaultNotice
	}
	title := "SecureEndpoint - activity tracking"
	switch runtime.GOOS {
	case "windows":
		// A toast needs an AppUserModelID; a balloon via NotifyIcon works for any process.
		ps := `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;` +
			`$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information;` +
			`$n.BalloonTipTitle = $env:SEM_TITLE; $n.BalloonTipText = $env:SEM_TEXT; $n.Visible = $true;` +
			`$n.ShowBalloonTip(15000); Start-Sleep -Seconds 16; $n.Dispose()`
		_, _ = platform.RunEnv(ctx, 30*time.Second, []string{"SEM_TITLE=" + title, "SEM_TEXT=" + text},
			"powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps)
	case "darwin":
		_, _ = platform.Run(ctx, 10*time.Second, "osascript", "-e",
			"display notification "+appleQuote(text)+" with title "+appleQuote(title))
	default:
		if platform.HasCommand("notify-send") {
			_, _ = platform.Run(ctx, 10*time.Second, "notify-send", "-a", "SecureEndpoint", title, text)
		}
	}
}

func appleQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}
