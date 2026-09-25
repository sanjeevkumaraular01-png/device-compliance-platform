//go:build windows

package software

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

var msiGUIDRE = regexp.MustCompile(`(?i)msiexec(?:\.exe)?"?\s.*?/[IX]\s*(\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\})`)
var guidRE = regexp.MustCompile(`(?i)^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$`)

func uninstall(ctx context.Context, item model.Software) (string, error) {
	if q := strings.TrimSpace(item.QuietUninstallString); q != "" {
		return RunCommandLine(ctx, 30*time.Minute, q)
	}
	guid := ""
	if m := msiGUIDRE.FindStringSubmatch(item.UninstallString); m != nil {
		guid = m[1]
	} else if guidRE.MatchString(item.PackageID) && strings.Contains(strings.ToLower(item.UninstallString), "msiexec") {
		guid = item.PackageID
	}
	if guid != "" {
		return RunCommandLine(ctx, 30*time.Minute, `msiexec.exe /x `+guid+` /qn /norestart REBOOT=ReallySuppress`)
	}
	return "", fmt.Errorf("%w: %q has no QuietUninstallString and is not an MSI package", ErrNoSilentUninstall, item.Name)
}

// RunCommandLine runs a raw Windows command line (as stored in the registry)
// without a shell. Exit codes 0, 3010 and 1641 (reboot required) are success.
func RunCommandLine(ctx context.Context, timeout time.Duration, cmdline string) (string, error) {
	exe := commandExe(cmdline)
	if exe == "" {
		return "", fmt.Errorf("cannot parse command line %q", cmdline)
	}
	path, err := exec.LookPath(exe)
	if err != nil {
		return "", err
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, path)
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: cmdline, HideWindow: true}
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	err = cmd.Run()
	out := strings.TrimSpace(buf.String())
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			switch ee.ExitCode() {
			case 3010, 1641:
				return strings.TrimSpace(out + "\n(reboot required)"), nil
			}
		}
		return out, fmt.Errorf("%s: %w", exe, err)
	}
	return out, nil
}

// commandExe extracts the executable from a command line.
func commandExe(cmdline string) string {
	s := strings.TrimSpace(cmdline)
	if strings.HasPrefix(s, `"`) {
		if i := strings.Index(s[1:], `"`); i >= 0 {
			return s[1 : i+1]
		}
		return ""
	}
	if i := strings.Index(strings.ToLower(s), ".exe"); i >= 0 {
		return s[:i+4]
	}
	if f := strings.Fields(s); len(f) > 0 {
		return f[0]
	}
	return ""
}
