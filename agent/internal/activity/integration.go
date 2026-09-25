package activity

import (
	"encoding/json"
	"strings"
)

// nativeHostManifest is the Chrome/Edge native messaging host manifest.
type nativeHostManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// NativeHostManifestJSON renders the manifest for the given agent executable
// and extension IDs (from `sem-agent install --extension-id <id>`).
func NativeHostManifestJSON(exe string, extensionIDs []string) ([]byte, error) {
	origins := make([]string, 0, len(extensionIDs))
	for _, id := range extensionIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			origins = append(origins, "chrome-extension://"+id+"/")
		}
	}
	return json.MarshalIndent(nativeHostManifest{
		Name:           NativeHostName,
		Description:    "SecureEndpoint agent: receives the active tab hostname (never the full URL)",
		Path:           exe,
		Type:           "stdio",
		AllowedOrigins: origins,
	}, "", "  ")
}

// IsNativeHostInvocation reports whether the browser launched the agent as a
// native messaging host (Chrome passes the caller origin as the first argument).
func IsNativeHostInvocation(args []string) bool {
	return len(args) > 0 && strings.HasPrefix(args[0], "chrome-extension://")
}
