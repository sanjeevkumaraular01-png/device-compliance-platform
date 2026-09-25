//go:build windows

package enforce

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

func setDWORD(root registry.Key, path, name string, v uint32) (bool, error) {
	k, _, err := registry.CreateKey(root, path, registry.QUERY_VALUE|registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return false, err
	}
	defer k.Close()
	if cur, _, err := k.GetIntegerValue(name); err == nil && cur == uint64(v) {
		return false, nil
	}
	return true, k.SetDWordValue(name, v)
}

func setString(root registry.Key, path, name, v string) (bool, error) {
	k, _, err := registry.CreateKey(root, path, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return false, err
	}
	defer k.Close()
	if cur, _, err := k.GetStringValue(name); err == nil && cur == v {
		return false, nil
	}
	return true, k.SetStringValue(name, v)
}

func screenLock(ctx context.Context, log *slog.Logger, p model.ScreenLockPolicy) Result {
	r := Result{Setting: "screenLock"}
	timeout := timeoutOrDefault(p.TimeoutSec)
	// Machine inactivity limit: locks the session after N seconds for every user.
	changed, err := setDWORD(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`, "InactivityTimeoutSecs", uint32(timeout))
	if err != nil {
		return errResult(r.Setting, err)
	}
	r.Changed = changed
	// Screen saver policy for each logged-on user hive (user policy keys).
	secure := "0"
	if p.RequirePassword {
		secure = "1"
	}
	var errs []string
	for _, sid := range collector.LoadedUserSIDs() {
		path := sid + `\Software\Policies\Microsoft\Windows\Control Panel\Desktop`
		vals := map[string]string{
			"ScreenSaveActive":    "1",
			"ScreenSaverIsSecure": secure,
			"ScreenSaveTimeOut":   strconv.Itoa(timeout),
		}
		if p.ScreenSaver {
			vals["SCRNSAVE.EXE"] = `C:\Windows\System32\scrnsave.scr`
		}
		for name, v := range vals {
			c, err := setString(registry.USERS, path, name, v)
			if err != nil {
				errs = append(errs, sid+": "+err.Error())
				continue
			}
			r.Changed = r.Changed || c
		}
	}
	r.Detail = fmt.Sprintf("InactivityTimeoutSecs=%d, screen saver secure=%s", timeout, secure)
	if len(errs) > 0 {
		r.Error = strings.Join(errs, "; ")
	}
	return r
}

func autoUpdate(ctx context.Context, log *slog.Logger) Result {
	r := Result{Setting: "autoUpdate"}
	const au = `SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`
	c1, err := setDWORD(registry.LOCAL_MACHINE, au, "NoAutoUpdate", 0)
	if err != nil {
		return errResult(r.Setting, err)
	}
	c2, err := setDWORD(registry.LOCAL_MACHINE, au, "AUOptions", 4) // auto download and schedule install
	if err != nil {
		return errResult(r.Setting, err)
	}
	r.Changed = c1 || c2
	// Make sure the Windows Update service is not disabled.
	if v, ok := collector.RegInt(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\wuauserv`, "Start"); ok && v == 4 {
		if _, err := setDWORD(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\wuauserv`, "Start", 3); err == nil {
			r.Changed = true
			r.Detail = "wuauserv re-enabled; "
		}
	}
	r.Detail += "NoAutoUpdate=0, AUOptions=4"
	return r
}

func firewall(ctx context.Context, log *slog.Logger, state string) Result {
	r := Result{Setting: "firewall"}
	if state == model.StateEnabled {
		r.Detail = "all profiles already enabled"
		return r
	}
	out, err := platform.RunCombined(ctx, 60*time.Second, nil, "netsh.exe", "advfirewall", "set", "allprofiles", "state", "on")
	if err != nil {
		return errResult(r.Setting, fmt.Errorf("%v: %s", err, out))
	}
	r.Changed, r.Detail = true, "netsh advfirewall set allprofiles state on"
	return r
}
