//go:build windows

package platform

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/windows"
)

func defaultDataDir() string {
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "SecureEndpoint")
}

func defaultStateDir() string { return filepath.Join(defaultDataDir(), "state") }
func defaultLogDir() string   { return filepath.Join(defaultDataDir(), "logs") }

// InstallDir is where the installer places the binary.
func InstallDir() string {
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}
	return filepath.Join(pf, "SecureEndpoint")
}

// Protected DACL: full control for LocalSystem and BUILTIN\Administrators
// only, inheritance from parent blocked, children inherit (OI)(CI).
const (
	sddlDir  = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
	sddlFile = "D:P(A;;FA;;;SY)(A;;FA;;;BA)"
)

func applySDDL(path, sddl string) error {
	sd, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, dacl, nil)
}

func secureDir(path string) error {
	if !IsAdmin() {
		return nil // best effort when running unprivileged (collect/dev)
	}
	return applySDDL(path, sddlDir)
}

func secureFile(path string) error {
	if !IsAdmin() {
		return nil
	}
	return applySDDL(path, sddlFile)
}

// IsAdmin reports whether the process runs elevated (or as SYSTEM).
func IsAdmin() bool {
	return windows.GetCurrentProcessToken().IsElevated()
}

// IsSystem reports whether the process runs as LocalSystem (i.e. as the service).
func IsSystem() bool {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return false
	}
	sys, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return false
	}
	return u.User.Sid.Equals(sys)
}

func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}
