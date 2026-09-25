package activity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// activeTab is written by `sem-agent native-host` (launched by the browser
// extension in the user's session) and read by the helper. Only the sanitized
// hostname is stored.
type activeTab struct {
	Host    string    `json:"host"`
	Browser string    `json:"browser"`
	At      time.Time `json:"at"`
}

func activeTabPath() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "SecureEndpoint", "active-tab.json"), nil
}

// WriteActiveDomain records the active tab's hostname for the helper.
func WriteActiveDomain(rawHost, browser string) error {
	host := SanitizeDomain(rawHost)
	p, err := activeTabPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(activeTab{Host: host, Browser: browser, At: time.Now()})
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// ReadActiveDomain returns the latest hostname if reported within maxAge.
func ReadActiveDomain(maxAge time.Duration) (host, browser string) {
	p, err := activeTabPath()
	if err != nil {
		return "", ""
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", ""
	}
	var t activeTab
	if json.Unmarshal(b, &t) != nil || time.Since(t.At) > maxAge {
		return "", ""
	}
	return t.Host, t.Browser
}

// IsBrowser reports whether a foreground app name is a supported browser.
func IsBrowser(app string) bool {
	switch normalizeApp(app) {
	case "chrome", "msedge", "Google Chrome", "Microsoft Edge", "chromium", "chromium-browser", "google-chrome", "brave", "Brave Browser":
		return true
	}
	return false
}
