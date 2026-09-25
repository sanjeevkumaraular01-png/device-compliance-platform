//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"runtime"
)

func defaultDataDir() string {
	if runtime.GOOS == "darwin" {
		return "/Library/Application Support/SecureEndpoint"
	}
	return "/etc/sem-agent"
}

func defaultStateDir() string {
	if runtime.GOOS == "darwin" {
		return "/Library/Application Support/SecureEndpoint/state"
	}
	return "/var/lib/sem-agent"
}

func defaultLogDir() string {
	if runtime.GOOS == "darwin" {
		return "/Library/Logs/SecureEndpoint"
	}
	return "/var/log/sem-agent"
}

// InstallDir is where the installer places the binary.
func InstallDir() string { return "/usr/local/bin" }

func secureDir(path string) error {
	if err := os.Chmod(path, 0o700); err != nil {
		return err
	}
	if IsAdmin() {
		return os.Chown(path, 0, 0)
	}
	return nil
}

func secureFile(path string) error {
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	if IsAdmin() {
		return os.Chown(path, 0, 0)
	}
	return nil
}

// IsAdmin reports whether the process runs as root.
func IsAdmin() bool { return os.Geteuid() == 0 }

// IsSystem is IsAdmin on Unix.
func IsSystem() bool { return IsAdmin() }

func hideWindow(*exec.Cmd) {}
