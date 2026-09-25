//go:build windows

package commands

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/platform"
)

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	procLockWorkStation = user32.NewProc("LockWorkStation")
)

// lockScreen locks every active interactive session.
//
// A service runs in session 0 where LockWorkStation has no effect, so as
// LocalSystem the agent enumerates sessions (WTSEnumerateSessions), obtains
// each active user's token (WTSQueryUserToken) and launches
// "rundll32.exe user32.dll,LockWorkStation" on that user's desktop. If that
// fails, a one-shot scheduled task for the BUILTIN\Users group is used.
func lockScreen(ctx context.Context, log *slog.Logger) (string, error) {
	if !platform.IsSystem() {
		if r, _, err := procLockWorkStation.Call(); r == 0 {
			return "", fmt.Errorf("LockWorkStation: %w", err)
		}
		return "workstation locked", nil
	}
	locked, err := lockViaSessions()
	if locked > 0 {
		return fmt.Sprintf("locked %d interactive session(s)", locked), nil
	}
	log.Warn("session lock via user token failed, falling back to scheduled task", "err", fmt.Sprint(err))
	if terr := lockViaScheduledTask(ctx); terr != nil {
		return "", errors.Join(err, terr)
	}
	return "lock requested via scheduled task", nil
}

func lockViaSessions() (int, error) {
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		return 0, fmt.Errorf("WTSEnumerateSessions: %w", err)
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	list := unsafe.Slice(sessions, count)
	locked := 0
	var lastErr error
	for _, s := range list {
		if s.State != windows.WTSActive || s.SessionID == 0 {
			continue
		}
		var tok windows.Token
		if err := windows.WTSQueryUserToken(s.SessionID, &tok); err != nil {
			lastErr = err
			continue
		}
		err := runAsToken(tok, `C:\Windows\System32\rundll32.exe`, `rundll32.exe user32.dll,LockWorkStation`)
		tok.Close()
		if err != nil {
			lastErr = err
			continue
		}
		locked++
	}
	if locked == 0 && lastErr == nil {
		lastErr = errors.New("no active interactive session")
	}
	return locked, lastErr
}

func runAsToken(tok windows.Token, app, cmdline string) error {
	appPtr, err := windows.UTF16PtrFromString(app)
	if err != nil {
		return err
	}
	cmdPtr, err := windows.UTF16PtrFromString(cmdline)
	if err != nil {
		return err
	}
	desktop, _ := windows.UTF16PtrFromString(`winsta0\default`)
	si := &windows.StartupInfo{Desktop: desktop}
	si.Cb = uint32(unsafe.Sizeof(*si))
	var pi windows.ProcessInformation
	if err := windows.CreateProcessAsUser(tok, appPtr, cmdPtr, nil, nil, false,
		windows.CREATE_NO_WINDOW|windows.CREATE_UNICODE_ENVIRONMENT, nil, nil, si, &pi); err != nil {
		return fmt.Errorf("CreateProcessAsUser: %w", err)
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}

const lockTaskName = `\SecureEndpoint\LockScreen`

const lockTaskXML = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>SecureEndpoint remote screen lock</Description></RegistrationInfo>
  <Principals>
    <Principal id="Users"><GroupId>S-1-5-32-545</GroupId><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Users">
    <Exec><Command>rundll32.exe</Command><Arguments>user32.dll,LockWorkStation</Arguments></Exec>
  </Actions>
</Task>
`

func lockViaScheduledTask(ctx context.Context) error {
	dir := platform.StateDir()
	_ = os.MkdirAll(dir, 0o700)
	path := filepath.Join(dir, "lock-task.xml")
	u := utf16.Encode([]rune(lockTaskXML))
	buf := make([]byte, 2+2*len(u))
	buf[0], buf[1] = 0xFF, 0xFE // UTF-16LE BOM
	for i, c := range u {
		buf[2+2*i] = byte(c)
		buf[3+2*i] = byte(c >> 8)
	}
	if err := os.WriteFile(path, buf, 0o600); err != nil {
		return err
	}
	defer os.Remove(path)
	if out, err := platform.RunCombined(ctx, 30*time.Second, nil, "schtasks.exe", "/Create", "/TN", lockTaskName, "/XML", path, "/F"); err != nil {
		return fmt.Errorf("schtasks create: %v %s", err, out)
	}
	defer func() {
		time.Sleep(5 * time.Second)
		_, _ = platform.RunCombined(context.Background(), 30*time.Second, nil, "schtasks.exe", "/Delete", "/TN", lockTaskName, "/F")
	}()
	if out, err := platform.RunCombined(ctx, 30*time.Second, nil, "schtasks.exe", "/Run", "/TN", lockTaskName); err != nil {
		return fmt.Errorf("schtasks run: %v %s", err, out)
	}
	return nil
}

func restart(ctx context.Context, log *slog.Logger, delaySec int) (string, error) {
	d := restartDelay(delaySec)
	log.Warn("scheduling restart", "delaySec", d)
	return platform.RunCombined(ctx, 30*time.Second, nil, "shutdown.exe", "/r", "/t", strconv.Itoa(d),
		"/c", "SecureEndpoint: restart requested by IT", "/d", "p:4:1")
}

var (
	recoveryPwRE = regexp.MustCompile(`\b\d{6}(?:-\d{6}){7}\b`)
	protectorRE  = regexp.MustCompile(`\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}`)
)

// enableEncryption turns on BitLocker for the system drive with a TPM
// protector plus a numeric recovery password. The recovery password is
// returned in data.recoveryPassword so the server can escrow it (it is
// redacted from output/logs); it is also backed up to AD DS when joined.
func enableEncryption(ctx context.Context, log *slog.Logger) (string, map[string]any, error) {
	drive := os.Getenv("SystemDrive")
	if drive == "" {
		drive = "C:"
	}
	data := map[string]any{"drive": drive}
	status, _ := platform.RunCombined(ctx, time.Minute, nil, "manage-bde.exe", "-status", drive)
	if strings.Contains(status, "Protection On") {
		data["alreadyEnabled"] = true
		return "BitLocker protection is already on for " + drive, data, nil
	}
	var log2 []string
	if out, err := platform.RunCombined(ctx, 2*time.Minute, nil, "manage-bde.exe", "-protectors", "-add", drive, "-TPM"); err != nil {
		log2 = append(log2, "TPM protector: "+firstLine(out))
		if !strings.Contains(strings.ToLower(out), "already") {
			return strings.Join(log2, "\n"), data, fmt.Errorf("adding TPM protector failed (TPM missing or not ready?): %v", err)
		}
	} else {
		log2 = append(log2, "TPM protector added")
	}
	out, err := platform.RunCombined(ctx, 2*time.Minute, nil, "manage-bde.exe", "-protectors", "-add", drive, "-RecoveryPassword")
	if err != nil {
		return strings.Join(log2, "\n"), data, fmt.Errorf("adding recovery password failed: %v", err)
	}
	if pw := recoveryPwRE.FindString(out); pw != "" {
		data["recoveryPassword"] = pw
		data["escrow"] = "server"
	}
	if id := protectorRE.FindString(out); id != "" {
		data["recoveryKeyId"] = id
		if ad, err := platform.RunCombined(ctx, 2*time.Minute, nil, "manage-bde.exe", "-protectors", "-adbackup", drive, "-id", id); err == nil {
			data["adBackup"] = true
		} else {
			data["adBackup"] = false
			log2 = append(log2, "AD backup skipped: "+firstLine(ad))
		}
	}
	log2 = append(log2, "recovery password protector added (value escrowed, redacted here)")
	on, err := platform.RunCombined(ctx, 5*time.Minute, nil, "manage-bde.exe", "-on", drive, "-UsedSpaceOnly", "-SkipHardwareTest")
	on = recoveryPwRE.ReplaceAllString(on, "******-******-…")
	log2 = append(log2, firstLine(on))
	if err != nil {
		return strings.Join(log2, "\n"), data, fmt.Errorf("manage-bde -on failed: %v", err)
	}
	log.Info("BitLocker encryption started", "drive", drive)
	return strings.Join(log2, "\n"), data, nil
}

func firstLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "BitLocker Drive Encryption:") && !strings.HasPrefix(l, "Copyright") {
			return l
		}
	}
	return strings.TrimSpace(s)
}

func installPatches(ctx context.Context, log *slog.Logger, req PatchRequest) (string, map[string]any, error) {
	ids, rejected := SafeArgs(req.PatchIDs)
	if len(req.PatchIDs) > 0 && len(ids) == 0 {
		return "", map[string]any{"rejectedPatchIds": rejected}, errors.New("no valid patch ids")
	}
	cctx, cancel := context.WithTimeout(ctx, 3*time.Hour)
	defer cancel()
	res, err := collector.InstallWindowsUpdates(cctx, collector.UpdateFilter{PatchIDs: ids, Severities: req.Severities})
	data := map[string]any{}
	if res != nil {
		data["installed"] = res.Installed
		data["failed"] = res.Failed
		data["rebootRequired"] = res.RebootRequired
		data["resultCode"] = res.ResultCode
	}
	if len(rejected) > 0 {
		data["rejectedPatchIds"] = rejected
	}
	if err != nil {
		return "", data, err
	}
	out := fmt.Sprintf("installed %d update(s), %d failed", len(res.Installed), len(res.Failed))
	if len(res.Installed) == 0 && len(res.Failed) == 0 {
		out = "no applicable updates found"
	}
	if res.RebootRequired && req.Reboot == "if-required" {
		if o, e := restart(ctx, log, 300); e == nil {
			data["rebootScheduled"] = true
			out += "; restart scheduled in 5 minutes " + o
		}
	}
	if len(res.Failed) > 0 && len(res.Installed) == 0 {
		return out, data, errors.New("all selected updates failed to install")
	}
	return out, data, nil
}
