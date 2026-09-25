//go:build windows

package activity

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"

	"github.com/secureendpoint/agent/internal/platform"
)

const runKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`
const runValue = "SecureEndpointUserHelper"

var nativeHostKeys = []string{
	`SOFTWARE\Google\Chrome\NativeMessagingHosts\` + NativeHostName,
	`SOFTWARE\Microsoft\Edge\NativeMessagingHosts\` + NativeHostName,
}

// InstallIntegration registers the per-user helper to start at every user
// logon and registers the browser native messaging host.
func InstallIntegration(exe string, extensionIDs []string) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	err = k.SetStringValue(runValue, `"`+exe+`" user-helper`)
	k.Close()
	if err != nil {
		return err
	}
	manifest, err := NativeHostManifestJSON(exe, extensionIDs)
	if err != nil {
		return err
	}
	mpath := filepath.Join(platform.DataDir(), "native-host.json")
	if err := os.WriteFile(mpath, manifest, 0o644); err != nil {
		return err
	}
	for _, key := range nativeHostKeys {
		nk, _, err := registry.CreateKey(registry.LOCAL_MACHINE, key, registry.SET_VALUE)
		if err != nil {
			return err
		}
		err = nk.SetStringValue("", mpath)
		nk.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveIntegration undoes InstallIntegration.
func RemoveIntegration() error {
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, runKey, registry.SET_VALUE); err == nil {
		_ = k.DeleteValue(runValue)
		k.Close()
	}
	for _, key := range nativeHostKeys {
		_ = registry.DeleteKey(registry.LOCAL_MACHINE, key)
	}
	_ = os.Remove(filepath.Join(platform.DataDir(), "native-host.json"))
	return nil
}
