//go:build darwin

package collector

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

const probeTimeout = 20 * time.Second

func sysctl(ctx context.Context, name string) string {
	out, _ := platform.Run(ctx, 5*time.Second, "sysctl", "-n", name)
	return strings.TrimSpace(out)
}

func machineID(ctx context.Context) string {
	out, err := platform.Run(ctx, 10*time.Second, "ioreg", "-rd1", "-c", "IOPlatformExpertDevice")
	if err != nil {
		return ""
	}
	m := regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`).FindStringSubmatch(out)
	if m != nil {
		return strings.ToUpper(m[1])
	}
	return ""
}

func isAppleSilicon(ctx context.Context) bool { return sysctl(ctx, "hw.optional.arm64") == "1" }

func collectHardware(ctx context.Context, log *slog.Logger) model.HardwareInfo {
	hw := model.HardwareInfo{Hostname: hostname(), Manufacturer: "Apple Inc."}
	out, err := platform.Run(ctx, 60*time.Second, "system_profiler", "SPHardwareDataType", "SPSoftwareDataType", "-json")
	if err == nil {
		var doc struct {
			HW []map[string]any `json:"SPHardwareDataType"`
			SW []map[string]any `json:"SPSoftwareDataType"`
		}
		if json.Unmarshal([]byte(out), &doc) == nil {
			if len(doc.HW) > 0 {
				h := doc.HW[0]
				hw.SerialNumber = str(h["serial_number"])
				hw.Model = str(h["machine_model"])
				if name := str(h["machine_name"]); name != "" {
					hw.Model = strings.TrimSpace(name + " (" + hw.Model + ")")
				}
				hw.CPU = str(h["chip_type"])
				if hw.CPU == "" {
					hw.CPU = strings.TrimSpace(str(h["cpu_type"]) + " " + str(h["current_processor_speed"]))
				}
			}
			if len(doc.SW) > 0 {
				s := doc.SW[0]
				if ln := str(s["local_host_name"]); ln != "" {
					hw.DeviceName = ln
				}
			}
		}
	} else {
		log.Debug("system_profiler failed", "err", err.Error())
	}
	if hw.CPU == "" {
		hw.CPU = sysctl(ctx, "machdep.cpu.brand_string")
	}
	if n := sysctl(ctx, "hw.logicalcpu"); n != "" && hw.CPU != "" {
		hw.CPU += " (" + n + " logical CPUs)"
	}
	if v, err := strconv.ParseInt(sysctl(ctx, "hw.memsize"), 10, 64); err == nil {
		hw.RamMb = v / 1024 / 1024
	}
	var st syscall.Statfs_t
	if syscall.Statfs("/", &st) == nil {
		hw.StorageGb = int64(st.Blocks) * int64(st.Bsize) / 1_000_000_000
	}
	pv := sysctl(ctx, "kern.osproductversion")
	hw.OsName = "macOS " + pv
	if n, _ := platform.Run(ctx, 5*time.Second, "sw_vers", "-productName"); n != "" {
		hw.OsName = n + " " + pv
	}
	hw.OsVersion = pv
	hw.OsBuild = sysctl(ctx, "kern.osversion")
	hw.LoggedInUser = loggedInUser(ctx)
	if out, err := platform.Run(ctx, 10*time.Second, "dsconfigad", "-show"); err == nil {
		for _, l := range strings.Split(out, "\n") {
			if k, v, ok := strings.Cut(l, "="); ok && strings.TrimSpace(k) == "Active Directory Domain" {
				hw.Domain = strings.TrimSpace(v)
			}
		}
	}
	modelID := sysctl(ctx, "hw.model")
	switch {
	case strings.HasPrefix(modelID, "VirtualMac") || IsVirtualMachine(modelID):
		hw.DeviceType = model.DeviceVM
	case strings.HasPrefix(modelID, "MacBook"):
		hw.DeviceType = model.DeviceLaptop
	case strings.HasPrefix(modelID, "MacPro"):
		hw.DeviceType = model.DeviceWorkstation
	case strings.HasPrefix(modelID, "Xserve"):
		hw.DeviceType = model.DeviceServer
	default:
		hw.DeviceType = ClassifyDeviceType(nil, hw.Manufacturer, hw.Model+" "+modelID, false, false)
		if hw.DeviceType == model.DeviceOther {
			hw.DeviceType = model.DeviceDesktop
		}
	}
	return hw
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func loggedInUser(ctx context.Context) string {
	out, err := platform.Run(ctx, 5*time.Second, "stat", "-f", "%Su", "/dev/console")
	if err != nil || out == "root" || out == "_mbsetupuser" || out == "loginwindow" {
		return ""
	}
	return out
}

func runningNames(ctx context.Context) map[string]bool {
	names := map[string]bool{}
	if out, err := platform.Run(ctx, 10*time.Second, "ps", "-axco", "comm="); err == nil {
		for _, l := range strings.Split(out, "\n") {
			if l = strings.TrimSpace(l); l != "" {
				names[strings.ToLower(l)] = true
			}
		}
	}
	if out, err := platform.Run(ctx, 10*time.Second, "launchctl", "list"); err == nil {
		for _, l := range strings.Split(out, "\n") {
			f := strings.Fields(l)
			if len(f) == 3 && f[0] != "-" && f[0] != "PID" {
				names[strings.ToLower(f[2])] = true
			}
		}
	}
	return names
}

func collectSecurity(ctx context.Context, log *slog.Logger, s *model.SecurityStatus) {
	running := runningNames(ctx)
	arm := isAppleSilicon(ctx)

	step(ctx, log, "av-edr", probeTimeout, func(ctx context.Context) (func(), error) {
		edr := MatchProducts(EDRCatalog, running, platform.Exists)
		av := MatchProducts(AVCatalog, running, platform.Exists)
		for _, e := range edr {
			for _, p := range EDRCatalog {
				if p.Name == e.Product && p.IsAV {
					av = append(av, e)
				}
			}
		}
		edrState, edrProd := StateFromDetections(edr)
		avState, avProd := StateFromDetections(av)
		gk, _ := platform.RunCombined(ctx, 10*time.Second, nil, "spctl", "--status")
		gatekeeper := strings.Contains(gk, "assessments enabled")
		var xpAt time.Time
		for _, p := range []string{
			"/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist",
			"/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist",
			"/private/var/protected/xprotect/XProtect.bundle/Contents/Info.plist",
		} {
			if st, err := os.Stat(p); err == nil && st.ModTime().After(xpAt) {
				xpAt = st.ModTime()
			}
		}
		return func() {
			s.EdrState, s.EdrProduct = edrState, edrProd
			s.Raw["gatekeeper"] = gatekeeper
			if avState == model.StateEnabled {
				s.AntivirusState, s.AntivirusProduct = avState, avProd
				return
			}
			// Built-in XProtect is always on; it is effective only with Gatekeeper.
			if !xpAt.IsZero() {
				s.AntivirusProduct = "Apple XProtect"
				s.AntivirusSignatureAt = model.FormatTime(xpAt)
				switch {
				case !gatekeeper:
					s.AntivirusState = model.StateDisabled
				case time.Since(xpAt) > 30*24*time.Hour:
					s.AntivirusState = model.StateOutdated
				default:
					s.AntivirusState = model.StateEnabled
				}
				return
			}
			s.AntivirusState, s.AntivirusProduct = avState, avProd
		}, nil
	})

	step(ctx, log, "firewall", probeTimeout, func(ctx context.Context) (func(), error) {
		out, err := platform.Run(ctx, 10*time.Second, "/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate")
		if err != nil && out == "" {
			return nil, err
		}
		st := model.StateDisabled
		if strings.Contains(out, "enabled") || strings.Contains(out, "State = 1") || strings.Contains(out, "State = 2") {
			st = model.StateEnabled
		}
		return func() { s.FirewallState = st }, nil
	})

	step(ctx, log, "filevault", probeTimeout, func(ctx context.Context) (func(), error) {
		out, err := platform.Run(ctx, 15*time.Second, "fdesetup", "status")
		if err != nil && out == "" {
			return nil, err
		}
		st, method := model.StateUnknown, ""
		switch {
		case strings.Contains(out, "FileVault is On"):
			st, method = model.StateEnabled, "FileVault 2"
		case strings.Contains(out, "Encryption in progress"):
			st, method = model.StateEnabled, "FileVault 2 (encryption in progress)"
		case strings.Contains(out, "FileVault is Off"):
			st = model.StateDisabled
		}
		return func() { s.DiskEncryptionState, s.EncryptionMethod = st, method }, nil
	})

	step(ctx, log, "sip-secureboot", probeTimeout, func(ctx context.Context) (func(), error) {
		out, _ := platform.RunCombined(ctx, 10*time.Second, nil, "csrutil", "status")
		sip := strings.Contains(out, "status: enabled")
		t2 := false
		if !arm {
			if o, err := platform.Run(ctx, 30*time.Second, "system_profiler", "SPiBridgeDataType"); err == nil {
				t2 = strings.Contains(o, "T2")
			}
		}
		return func() {
			s.Raw["systemIntegrityProtection"] = sip
			secureEnclave := arm || t2
			s.TpmPresent = model.Bool(secureEnclave) // Secure Enclave plays the TPM role
			switch {
			case strings.Contains(out, "status: disabled"):
				s.SecureBootState = model.StateDisabled
			case secureEnclave && sip:
				s.SecureBootState = model.StateEnabled
			default:
				s.SecureBootState = model.StateUnknown
			}
		}, nil
	})

	step(ctx, log, "screenlock", probeTimeout, func(ctx context.Context) (func(), error) {
		user := loggedInUser(ctx)
		if user == "" {
			return nil, nil
		}
		asUser := func(args ...string) (string, error) {
			if platform.IsAdmin() {
				return platform.RunCombined(ctx, 10*time.Second, nil, "sudo", append([]string{"-u", user}, args...)...)
			}
			return platform.RunCombined(ctx, 10*time.Second, nil, args[0], args[1:]...)
		}
		idle := -1
		if o, err := asUser("defaults", "-currentHost", "read", "com.apple.screensaver", "idleTime"); err == nil {
			if v, err := strconv.Atoi(strings.TrimSpace(o)); err == nil {
				idle = v
			}
		}
		managed := filepath.Join("/Library/Managed Preferences", user, "com.apple.screensaver.plist")
		if platform.Exists(managed) || platform.Exists("/Library/Managed Preferences/com.apple.screensaver.plist") {
			if o, err := platform.Run(ctx, 5*time.Second, "defaults", "read", strings.TrimSuffix(managed, ".plist"), "idleTime"); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(o)); err == nil {
					idle = v
				}
			}
		}
		pw := true // macOS default: password required after sleep/screen saver
		o, _ := asUser("sysadminctl", "-screenLock", "status")
		lo := strings.ToLower(o)
		if strings.Contains(lo, "screenlock is off") {
			pw = false
		}
		return func() {
			s.PasswordOnWake = model.Bool(pw)
			if idle >= 0 {
				s.ScreenLockTimeoutSec = model.Int(idle)
				s.ScreenSaverEnabled = model.Bool(idle > 0)
				s.ScreenLockEnabled = model.Bool(idle > 0 && pw)
			} else {
				// Default: screen saver after 20 min (1200 s) on recent macOS.
				s.ScreenLockTimeoutSec = model.Int(1200)
				s.ScreenSaverEnabled = model.Bool(true)
				s.ScreenLockEnabled = model.Bool(pw)
			}
		}, nil
	})

	step(ctx, log, "autoupdate", probeTimeout, func(ctx context.Context) (func(), error) {
		read := func(key string) string {
			o, err := platform.Run(ctx, 5*time.Second, "defaults", "read", "/Library/Preferences/com.apple.SoftwareUpdate", key)
			if err != nil {
				return ""
			}
			return strings.TrimSpace(o)
		}
		check, crit := read("AutomaticCheckEnabled"), read("CriticalUpdateInstall")
		enabled := check != "0" && crit != "0"
		return func() { s.AutoUpdateEnabled = model.Bool(enabled) }, nil
	})

	step(ctx, log, "usbstorage", 5*time.Second, func(ctx context.Context) (func(), error) {
		blocked := platform.Exists(platform.StatePath("usb-block.active"))
		return func() { s.UsbStorageEnabled = model.Bool(!blocked) }, nil
	})

	step(ctx, log, "boot", 5*time.Second, func(ctx context.Context) (func(), error) {
		bt := sysctl(ctx, "kern.boottime") // { sec = 1700000000, usec = 0 } ...
		m := regexp.MustCompile(`sec = (\d+)`).FindStringSubmatch(bt)
		return func() {
			if m != nil {
				if v, err := strconv.ParseInt(m[1], 10, 64); err == nil {
					s.LastBootAt = model.FormatTime(time.Unix(v, 0))
				}
			}
		}, nil
	})
}

func collectSoftware(ctx context.Context, log *slog.Logger) ([]model.Software, error) {
	out, err := platform.Run(ctx, 150*time.Second, "system_profiler", "SPApplicationsDataType", "-json", "-detailLevel", "mini")
	if err != nil {
		return nil, err
	}
	var doc struct {
		Apps []struct {
			Name         string   `json:"_name"`
			Version      string   `json:"version"`
			ObtainedFrom string   `json:"obtained_from"`
			Path         string   `json:"path"`
			LastModified string   `json:"lastModified"`
			SignedBy     []string `json:"signed_by"`
			Info         string   `json:"info"`
		} `json:"SPApplicationsDataType"`
	}
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return nil, err
	}
	devID := regexp.MustCompile(`^Developer ID Application:\s*(.+?)\s*(\([A-Z0-9]+\))?$`)
	var items []model.Software
	for _, a := range doc.Apps {
		// Skip helper apps buried inside other bundles / system frameworks.
		if strings.Contains(a.Path, ".app/Contents/") || strings.HasPrefix(a.Path, "/System/Library/") || strings.HasPrefix(a.Path, "/Library/Apple/") {
			continue
		}
		s := model.Software{Name: a.Name, Version: a.Version, InstallLocation: a.Path, PackageID: a.Path, Source: "app"}
		switch a.ObtainedFrom {
		case "apple":
			s.Publisher, s.Source, s.Protected = "Apple", "system", true
		case "mac_app_store":
			s.Source = "mac_app_store"
		}
		if s.Publisher == "" && len(a.SignedBy) > 0 {
			if m := devID.FindStringSubmatch(a.SignedBy[0]); m != nil {
				s.Publisher = m[1]
			} else if strings.HasPrefix(a.SignedBy[0], "Apple Mac OS Application Signing") {
				s.Publisher = "Apple"
			}
		}
		if t, err := time.Parse(time.RFC3339, a.LastModified); err == nil {
			s.InstallDate = model.FormatTime(t)
		}
		if strings.HasPrefix(a.Path, "/System/") {
			s.Protected = true
		}
		items = append(items, s)
	}
	return items, nil
}

func collectPatches(ctx context.Context, log *slog.Logger) ([]model.Patch, error) {
	out, err := platform.RunCombined(ctx, 240*time.Second, nil, "softwareupdate", "--list", "--no-scan")
	if err != nil || !strings.Contains(out, "Label:") {
		out, err = platform.RunCombined(ctx, 240*time.Second, nil, "softwareupdate", "--list")
		if err != nil && out == "" {
			return nil, err
		}
	}
	return ParseSoftwareUpdateList(out), nil
}

// collectServices is Windows-focused; not collected on macOS for now.
func collectServices(ctx context.Context, log *slog.Logger) []model.Service { return nil }
