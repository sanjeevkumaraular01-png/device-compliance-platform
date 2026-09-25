//go:build windows

package activity

import (
	"context"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                 = windows.NewLazySystemDLL("user32.dll")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procGetForegroundWnd   = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadPID = user32.NewProc("GetWindowThreadProcessId")
	procGetWindowTextW     = user32.NewProc("GetWindowTextW")
	procGetLastInputInfo   = user32.NewProc("GetLastInputInfo")
	procOpenInputDesktop   = user32.NewProc("OpenInputDesktop")
	procCloseDesktop       = user32.NewProc("CloseDesktop")
	procGetTickCount64     = kernel32.NewProc("GetTickCount64")
)

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

type winProbe struct {
	in         inputTracker
	wantTitles bool
}

// NewProbe returns the Windows session probe. Window titles are only read
// when the policy allows them (wantTitles).
func NewProbe(wantTitles bool) Probe { return &winProbe{wantTitles: wantTitles} }

func (p *winProbe) Sample(_ context.Context) (Sample, error) {
	s := Sample{At: time.Now()}

	// Idle: milliseconds since the last keyboard/mouse input (no content).
	lii := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	if r, _, err := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&lii))); r == 0 {
		return s, err
	}
	tick, _, _ := procGetTickCount64.Call()
	// dwTime is a 32-bit tick count; compare in 32-bit space to survive wrap.
	idleMs := uint32(uint64(tick)) - lii.dwTime
	s.Input, s.Idle = p.in.observe(uint64(lii.dwTime), time.Duration(idleMs)*time.Millisecond)

	// Locked workstation / secure desktop: the input desktop cannot be opened.
	const desktopSwitchDesktop = 0x0100
	if h, _, _ := procOpenInputDesktop.Call(0, 0, desktopSwitchDesktop); h == 0 {
		s.Locked = true
		return s, nil
	} else {
		procCloseDesktop.Call(h)
	}

	hwnd, _, _ := procGetForegroundWnd.Call()
	if hwnd == 0 {
		return s, nil
	}
	var pid uint32
	procGetWindowThreadPID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid != 0 {
		if h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); err == nil {
			buf := make([]uint16, windows.MAX_PATH)
			n := uint32(len(buf))
			if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) == nil {
				s.App = normalizeApp(windows.UTF16ToString(buf[:n]))
			}
			windows.CloseHandle(h)
		}
	}
	if !p.wantTitles {
		return s, nil
	}
	title := make([]uint16, 512)
	if n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&title[0])), uintptr(len(title))); n > 0 {
		s.Title = windows.UTF16ToString(title[:n])
	}
	return s, nil
}
