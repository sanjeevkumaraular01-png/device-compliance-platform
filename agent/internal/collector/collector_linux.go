//go:build linux

package collector

import (
	"bufio"
	"context"
	"encoding/binary"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

const probeTimeout = 20 * time.Second

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func dmi(name string) string { return readTrim("/sys/class/dmi/id/" + name) }

func machineID(context.Context) string {
	for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		if id := readTrim(p); id != "" {
			return strings.ToUpper(id)
		}
	}
	if id := dmi("product_uuid"); id != "" {
		return strings.ToUpper(id)
	}
	return ""
}

// InContainer reports whether we run inside a container.
func InContainer() bool {
	if platform.Exists("/.dockerenv") || platform.Exists("/run/.containerenv") {
		return true
	}
	cg := readTrim("/proc/1/cgroup")
	return strings.Contains(cg, "docker") || strings.Contains(cg, "kubepods") || strings.Contains(cg, "containerd")
}

func collectHardware(ctx context.Context, log *slog.Logger) model.HardwareInfo {
	hw := model.HardwareInfo{Hostname: hostname()}
	hw.SerialNumber = dmi("product_serial")
	if !validSerial(hw.SerialNumber) {
		hw.SerialNumber = dmi("board_serial")
	}
	if !validSerial(hw.SerialNumber) {
		hw.SerialNumber = dmi("chassis_serial")
	}
	hw.Manufacturer = dmi("sys_vendor")
	hw.Model = strings.TrimSpace(dmi("product_name") + " " + dmi("product_version"))
	if strings.EqualFold(strings.TrimSpace(dmi("product_version")), "none") || dmi("product_version") == "" {
		hw.Model = dmi("product_name")
	}
	if hw.Model == "" { // ARM boards (Raspberry Pi, etc.)
		hw.Model = strings.TrimRight(readTrim("/proc/device-tree/model"), "\x00")
	}

	// CPU
	if f, err := os.Open("/proc/cpuinfo"); err == nil {
		sc := bufio.NewScanner(f)
		cores := 0
		for sc.Scan() {
			k, v, ok := strings.Cut(sc.Text(), ":")
			if !ok {
				continue
			}
			k = strings.TrimSpace(k)
			switch k {
			case "model name", "Hardware", "cpu model", "Model":
				if hw.CPU == "" {
					hw.CPU = strings.TrimSpace(v)
				}
			case "processor":
				cores++
			}
		}
		f.Close()
		if hw.CPU == "" {
			if out, err := platform.Run(ctx, probeTimeout, "lscpu"); err == nil {
				for _, l := range strings.Split(out, "\n") {
					if k, v, ok := strings.Cut(l, ":"); ok && strings.TrimSpace(k) == "Model name" {
						hw.CPU = strings.TrimSpace(v)
						break
					}
				}
			}
		}
		if cores > 0 && hw.CPU != "" {
			hw.CPU += " (" + strconv.Itoa(cores) + " logical CPUs)"
		}
	}

	// RAM
	if f, err := os.Open("/proc/meminfo"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			fs := strings.Fields(sc.Text())
			if len(fs) >= 2 && fs[0] == "MemTotal:" {
				if kb, err := strconv.ParseInt(fs[1], 10, 64); err == nil {
					hw.RamMb = kb / 1024
				}
				break
			}
		}
		f.Close()
	}

	hw.StorageGb = linuxStorageGb()

	// OS
	osr := ParseOSRelease(readTrim("/etc/os-release"))
	hw.OsName = osr["PRETTY_NAME"]
	if hw.OsName == "" {
		hw.OsName = osr["NAME"]
	}
	hw.OsVersion = osr["VERSION_ID"]
	hw.OsBuild = readTrim("/proc/sys/kernel/osrelease")

	hw.LoggedInUser = loggedInUser(ctx)
	hw.Domain = linuxDomain(ctx)

	chassis := []int{}
	if c, err := strconv.Atoi(dmi("chassis_type")); err == nil {
		chassis = append(chassis, c)
	}
	virt := false
	if out, err := platform.Run(ctx, 5*time.Second, "systemd-detect-virt", "--vm"); err == nil && out != "" && out != "none" {
		virt = true
	}
	hasBattery := false
	if m, _ := filepath.Glob("/sys/class/power_supply/BAT*"); len(m) > 0 {
		hasBattery = true
	}
	serverOS := !hasGUI()
	if virt {
		hw.DeviceType = model.DeviceVM
	} else {
		hw.DeviceType = ClassifyDeviceType(chassis, hw.Manufacturer, hw.Model, serverOS, hasBattery)
	}
	_ = log
	return hw
}

func hasGUI() bool {
	for _, p := range []string{"/usr/bin/gnome-shell", "/usr/bin/plasmashell", "/usr/bin/xfce4-session", "/usr/bin/Xorg", "/usr/bin/Xwayland", "/usr/bin/cinnamon-session", "/usr/bin/mate-session"} {
		if platform.Exists(p) {
			return true
		}
	}
	return false
}

// linuxStorageGb sums physical block devices from /sys/block (sizes are in
// 512-byte sectors), falling back to statfs("/").
func linuxStorageGb() int64 {
	var total int64
	entries, _ := os.ReadDir("/sys/block")
	for _, e := range entries {
		n := e.Name()
		if strings.HasPrefix(n, "loop") || strings.HasPrefix(n, "ram") || strings.HasPrefix(n, "zram") ||
			strings.HasPrefix(n, "dm-") || strings.HasPrefix(n, "sr") || strings.HasPrefix(n, "md") || strings.HasPrefix(n, "nbd") {
			continue
		}
		if readTrim(filepath.Join("/sys/block", n, "removable")) == "1" {
			continue
		}
		if s, err := strconv.ParseInt(readTrim(filepath.Join("/sys/block", n, "size")), 10, 64); err == nil {
			total += s * 512
		}
	}
	if total == 0 {
		var st syscall.Statfs_t
		if syscall.Statfs("/", &st) == nil {
			total = int64(st.Blocks) * int64(st.Bsize)
		}
	}
	return total / 1_000_000_000
}

func linuxDomain(ctx context.Context) string {
	if platform.HasCommand("realm") {
		if out, err := platform.Run(ctx, 10*time.Second, "realm", "list", "--name-only"); err == nil {
			if l := strings.TrimSpace(strings.Split(out, "\n")[0]); l != "" {
				return l
			}
		}
	}
	if out, err := platform.Run(ctx, 5*time.Second, "hostname", "-d"); err == nil && out != "" && out != "(none)" && out != "localdomain" {
		return out
	}
	return ""
}

// graphicalSession returns the user and uid of the active graphical session.
func graphicalSession(ctx context.Context) (string, string) {
	out, err := platform.Run(ctx, 10*time.Second, "loginctl", "list-sessions", "--no-legend")
	if err == nil {
		var fallbackUser, fallbackUID string
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			if len(f) < 3 {
				continue
			}
			id, uid, user := f[0], f[1], f[2]
			props, err := platform.Run(ctx, 5*time.Second, "loginctl", "show-session", id, "-p", "Type", "-p", "Active", "-p", "Class")
			if err != nil {
				continue
			}
			if !strings.Contains(props, "Class=user") {
				continue
			}
			if fallbackUser == "" {
				fallbackUser, fallbackUID = user, uid
			}
			if (strings.Contains(props, "Type=x11") || strings.Contains(props, "Type=wayland")) && strings.Contains(props, "Active=yes") {
				return user, uid
			}
		}
		if fallbackUser != "" {
			return fallbackUser, fallbackUID
		}
	}
	return "", ""
}

func loggedInUser(ctx context.Context) string {
	if u, _ := graphicalSession(ctx); u != "" {
		return u
	}
	if out, err := platform.Run(ctx, 5*time.Second, "who"); err == nil {
		for _, l := range strings.Split(out, "\n") {
			if f := strings.Fields(l); len(f) > 0 {
				return f[0]
			}
		}
	}
	if u := os.Getenv("SUDO_USER"); u != "" {
		return u
	}
	return ""
}

// runningNames returns lowercase process names (comm + exe basename) and
// active systemd unit names.
func runningNames(ctx context.Context) map[string]bool {
	names := map[string]bool{}
	entries, _ := os.ReadDir("/proc")
	for _, e := range entries {
		if _, err := strconv.Atoi(e.Name()); err != nil {
			continue
		}
		if c := readTrim(filepath.Join("/proc", e.Name(), "comm")); c != "" {
			names[strings.ToLower(c)] = true
		}
		if exe, err := os.Readlink(filepath.Join("/proc", e.Name(), "exe")); err == nil {
			names[strings.ToLower(filepath.Base(exe))] = true
		}
	}
	if out, err := platform.Run(ctx, 10*time.Second, "systemctl", "list-units", "--type=service", "--state=active", "--no-legend", "--plain"); err == nil {
		for _, l := range strings.Split(out, "\n") {
			if f := strings.Fields(l); len(f) > 0 {
				u := strings.ToLower(strings.TrimSuffix(f[0], ".service"))
				names[u] = true
			}
		}
	}
	return names
}

func collectSecurity(ctx context.Context, log *slog.Logger, s *model.SecurityStatus) {
	running := runningNames(ctx)
	container := InContainer()
	if container {
		s.Raw["container"] = true
	}

	// EDR + AV
	step(ctx, log, "edr", probeTimeout, func(ctx context.Context) (func(), error) {
		edr := MatchProducts(EDRCatalog, running, platform.Exists)
		av := MatchProducts(AVCatalog, running, platform.Exists)
		edrState, edrProd := StateFromDetections(edr)
		var avDet []DetectResult
		avDet = append(avDet, av...)
		for _, e := range edr {
			for _, p := range EDRCatalog {
				if p.Name == e.Product && p.IsAV {
					avDet = append(avDet, e)
				}
			}
		}
		avState, avProd := StateFromDetections(avDet)
		sigAt := clamSignatureTime()
		return func() {
			s.EdrState, s.EdrProduct = edrState, edrProd
			s.AntivirusState, s.AntivirusProduct = avState, avProd
			if !sigAt.IsZero() && strings.Contains(avProd, "ClamAV") {
				s.AntivirusSignatureAt = model.FormatTime(sigAt)
				if time.Since(sigAt) > 7*24*time.Hour && avState == model.StateEnabled && len(avDet) == 1 {
					s.AntivirusState = model.StateOutdated
				}
			}
		}, nil
	})

	step(ctx, log, "firewall", probeTimeout, func(ctx context.Context) (func(), error) {
		st, prod := linuxFirewall(ctx, running)
		return func() {
			s.FirewallState = st
			if prod != "" {
				s.Raw["firewall"] = prod
			}
		}, nil
	})

	step(ctx, log, "encryption", probeTimeout, func(ctx context.Context) (func(), error) {
		out, err := platform.Run(ctx, probeTimeout, "lsblk", "-J", "-o", "NAME,TYPE,FSTYPE,MOUNTPOINT")
		if err != nil {
			return nil, err
		}
		st, method := ParseLsblkRootEncryption([]byte(out))
		return func() { s.DiskEncryptionState, s.EncryptionMethod = st, method }, nil
	})

	step(ctx, log, "secureboot", probeTimeout, func(ctx context.Context) (func(), error) {
		st := linuxSecureBoot(ctx, container)
		tpm := platform.Exists("/sys/class/tpm/tpm0") || platform.Exists("/dev/tpm0") || platform.Exists("/dev/tpmrm0")
		return func() {
			s.SecureBootState = st
			if !container {
				s.TpmPresent = model.Bool(tpm)
			}
		}, nil
	})

	step(ctx, log, "screenlock", probeTimeout, func(ctx context.Context) (func(), error) {
		enabled, timeout, ok := linuxScreenLock(ctx)
		if !ok {
			return nil, nil
		}
		return func() {
			s.ScreenLockEnabled = model.Bool(enabled && timeout > 0)
			s.ScreenLockTimeoutSec = model.Int(timeout)
			s.PasswordOnWake = model.Bool(enabled)
			s.ScreenSaverEnabled = model.Bool(timeout > 0)
		}, nil
	})

	step(ctx, log, "autoupdate", probeTimeout, func(ctx context.Context) (func(), error) {
		v, ok := linuxAutoUpdate(ctx)
		if !ok {
			return nil, nil
		}
		return func() { s.AutoUpdateEnabled = model.Bool(v) }, nil
	})

	step(ctx, log, "usbstorage", 5*time.Second, func(ctx context.Context) (func(), error) {
		v := linuxUsbStorageEnabled()
		return func() { s.UsbStorageEnabled = model.Bool(v) }, nil
	})

	step(ctx, log, "reboot", 15*time.Second, func(ctx context.Context) (func(), error) {
		var pending *bool
		if platform.Exists("/var/run/reboot-required") || platform.Exists("/run/reboot-required") {
			pending = model.Bool(true)
		} else if platform.HasCommand("needs-restarting") {
			_, err := platform.Run(ctx, 15*time.Second, "needs-restarting", "-r")
			pending = model.Bool(platform.ExitCode(err) == 1)
		} else if platform.HasCommand("dpkg") {
			pending = model.Bool(false)
		}
		boot := linuxBootTime()
		return func() {
			s.PendingRebootRequired = pending
			if !boot.IsZero() {
				s.LastBootAt = model.FormatTime(boot)
			}
		}, nil
	})
}

func linuxBootTime() time.Time {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return time.Time{}
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), "btime ") {
			if v, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(sc.Text(), "btime ")), 10, 64); err == nil {
				return time.Unix(v, 0)
			}
		}
	}
	return time.Time{}
}

func clamSignatureTime() time.Time {
	var newest time.Time
	for _, dir := range []string{"/var/lib/clamav", "/var/clamav", "/usr/local/share/clamav"} {
		for _, pat := range []string{"daily.c?d", "main.c?d", "bytecode.c?d"} {
			m, _ := filepath.Glob(filepath.Join(dir, pat))
			for _, f := range m {
				if st, err := os.Stat(f); err == nil && st.ModTime().After(newest) {
					newest = st.ModTime()
				}
			}
		}
	}
	return newest
}

func linuxFirewall(ctx context.Context, running map[string]bool) (string, string) {
	// ufw: the config file is world-readable, `ufw status` needs root.
	if platform.Exists("/etc/ufw/ufw.conf") || platform.HasCommand("ufw") {
		if platform.IsAdmin() {
			if out, err := platform.Run(ctx, probeTimeout, "ufw", "status"); err == nil {
				if strings.Contains(out, "Status: active") {
					return model.StateEnabled, "ufw"
				}
			}
		} else if strings.Contains(readTrim("/etc/ufw/ufw.conf"), "ENABLED=yes") {
			return model.StateEnabled, "ufw"
		}
	}
	if running["firewalld"] {
		return model.StateEnabled, "firewalld"
	}
	if platform.HasCommand("systemctl") {
		if out, _ := platform.Run(ctx, 5*time.Second, "systemctl", "is-active", "firewalld"); out == "active" {
			return model.StateEnabled, "firewalld"
		}
	}
	if !platform.IsAdmin() {
		return model.StateUnknown, ""
	}
	if platform.HasCommand("nft") {
		if out, err := platform.Run(ctx, probeTimeout, "nft", "list", "ruleset"); err == nil {
			if nftHasFiltering(out) {
				return model.StateEnabled, "nftables"
			}
		}
	}
	for _, ipt := range []string{"iptables", "iptables-legacy"} {
		if !platform.HasCommand(ipt) {
			continue
		}
		out, err := platform.Run(ctx, probeTimeout, ipt, "-S", "INPUT")
		if err != nil {
			continue
		}
		if iptablesHasFiltering(out) {
			return model.StateEnabled, ipt
		}
	}
	if platform.HasCommand("nft") || platform.HasCommand("iptables") || platform.HasCommand("ufw") {
		return model.StateDisabled, ""
	}
	return model.StateNotInstalled, ""
}

func nftHasFiltering(ruleset string) bool {
	for _, l := range strings.Split(ruleset, "\n") {
		l = strings.TrimSpace(l)
		if strings.Contains(l, "hook input") && (strings.Contains(l, "policy drop") || strings.Contains(l, "policy reject")) {
			return true
		}
		if strings.HasPrefix(l, "drop") || strings.HasPrefix(l, "reject") || strings.Contains(l, " drop") || strings.Contains(l, " reject") {
			return true
		}
	}
	return false
}

func iptablesHasFiltering(rules string) bool {
	for _, l := range strings.Split(rules, "\n") {
		l = strings.TrimSpace(l)
		if l == "-P INPUT DROP" || l == "-P INPUT REJECT" {
			return true
		}
		if strings.HasPrefix(l, "-A INPUT") && (strings.Contains(l, "-j DROP") || strings.Contains(l, "-j REJECT")) {
			return true
		}
	}
	return false
}

func linuxSecureBoot(ctx context.Context, container bool) string {
	if platform.HasCommand("mokutil") {
		out, err := platform.RunCombined(ctx, 10*time.Second, nil, "mokutil", "--sb-state")
		lo := strings.ToLower(out)
		switch {
		case strings.Contains(lo, "secureboot enabled"):
			return model.StateEnabled
		case strings.Contains(lo, "secureboot disabled"):
			return model.StateDisabled
		case strings.Contains(lo, "not supported") || strings.Contains(lo, "efi variables are not supported"):
			return model.StateDisabled
		}
		_ = err
	}
	vars, _ := filepath.Glob("/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c")
	if len(vars) > 0 {
		if b, err := os.ReadFile(vars[0]); err == nil && len(b) >= 5 {
			// 4 bytes of attributes followed by the value byte.
			_ = binary.LittleEndian.Uint32(b[:4])
			if b[4] == 1 {
				return model.StateEnabled
			}
			return model.StateDisabled
		}
	}
	if container {
		return model.StateUnknown
	}
	if !platform.Exists("/sys/firmware/efi") {
		return model.StateDisabled // legacy BIOS boot: Secure Boot not possible
	}
	return model.StateUnknown
}

// linuxScreenLock reads GNOME settings of the active graphical user through
// dconf (works without a D-Bus session). Returns ok=false when no GNOME
// session / desktop exists (headless servers).
func linuxScreenLock(ctx context.Context) (enabled bool, timeoutSec int, ok bool) {
	if !platform.HasCommand("dconf") && !platform.HasCommand("gsettings") {
		return false, 0, false
	}
	user, uid := graphicalSession(ctx)
	read := func(key string) string {
		var out string
		var err error
		switch {
		case user == "" || !platform.IsAdmin():
			out, err = platform.Run(ctx, 5*time.Second, "gsettings", "get", schemaOf(key), keyOf(key))
		default:
			env := []string{}
			if uid != "" {
				env = append(env, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"+uid+"/bus")
			}
			args := []string{"-u", user, "--", "env"}
			args = append(args, env...)
			args = append(args, "gsettings", "get", schemaOf(key), keyOf(key))
			out, err = platform.Run(ctx, 5*time.Second, "runuser", args...)
			if err != nil {
				out, err = platform.Run(ctx, 5*time.Second, "runuser", "-u", user, "--", "dconf", "read", key)
			}
		}
		if err != nil {
			return ""
		}
		return strings.TrimSpace(out)
	}
	delay := read("/org/gnome/desktop/session/idle-delay")
	lock := read("/org/gnome/desktop/screensaver/lock-enabled")
	if delay == "" && lock == "" {
		return false, 0, false
	}
	timeoutSec = 300 // GNOME default
	if delay != "" {
		f := strings.Fields(delay) // "uint32 300"
		if v, err := strconv.Atoi(f[len(f)-1]); err == nil {
			timeoutSec = v
		}
	}
	enabled = lock == "" || lock == "true"
	return enabled, timeoutSec, true
}

func schemaOf(key string) string {
	dir := filepath.Dir(key)
	return strings.ReplaceAll(strings.TrimPrefix(dir, "/"), "/", ".")
}
func keyOf(key string) string { return filepath.Base(key) }

func linuxAutoUpdate(ctx context.Context) (bool, bool) {
	if platform.HasCommand("dpkg") {
		conf := ""
		for _, f := range []string{"/etc/apt/apt.conf.d/20auto-upgrades", "/etc/apt/apt.conf.d/10periodic", "/etc/apt/apt.conf.d/50unattended-upgrades-sem"} {
			conf += readTrim(f) + "\n"
		}
		installed := platform.Exists("/usr/bin/unattended-upgrade")
		enabled := strings.Contains(conf, `APT::Periodic::Unattended-Upgrade "1"`) || strings.Contains(conf, `APT::Periodic::Unattended-Upgrade "true"`)
		return installed && enabled, true
	}
	if platform.HasCommand("systemctl") && (platform.HasCommand("dnf") || platform.HasCommand("yum")) {
		for _, unit := range []string{"dnf-automatic-install.timer", "dnf-automatic.timer", "dnf5-automatic.timer", "yum-cron.service"} {
			out, _ := platform.Run(ctx, 5*time.Second, "systemctl", "is-enabled", unit)
			if strings.TrimSpace(out) == "enabled" {
				if unit == "dnf-automatic.timer" {
					cfg := readTrim("/etc/dnf/automatic.conf")
					return strings.Contains(cfg, "apply_updates = yes") || strings.Contains(cfg, "apply_updates=yes"), true
				}
				return true, true
			}
		}
		return false, true
	}
	return false, false
}

// UsbRulesPath is the udev rule file written by the USB enforcer.
const UsbRulesPath = "/etc/udev/rules.d/99-sem-usb.rules"

func linuxUsbStorageEnabled() bool {
	files, _ := filepath.Glob("/etc/modprobe.d/*.conf")
	more, _ := filepath.Glob("/lib/modprobe.d/*.conf")
	files = append(files, more...)
	for _, f := range files {
		for _, l := range strings.Split(readTrim(f), "\n") {
			fs := strings.Fields(strings.TrimSpace(l))
			if len(fs) >= 2 && fs[1] == "usb_storage" && (fs[0] == "blacklist" || (fs[0] == "install" && len(fs) >= 3 && (strings.HasSuffix(fs[2], "/true") || strings.HasSuffix(fs[2], "/false")))) {
				return false
			}
		}
	}
	if b, err := os.ReadFile(UsbRulesPath); err == nil && strings.Contains(string(b), `ATTR{authorized}="0"`) {
		return false
	}
	return true
}

func collectSoftware(ctx context.Context, log *slog.Logger) ([]model.Software, error) {
	var items []model.Software
	if platform.HasCommand("dpkg-query") {
		out, err := platform.Run(ctx, 60*time.Second, "dpkg-query", "-W", "-f=${Package}\t${Version}\t${Maintainer}\t${Installed-Size}\t${db:Status-Abbrev}\t${Priority}\n")
		if err == nil {
			items = append(items, ParseDpkgQuery(out)...)
		} else {
			log.Debug("dpkg-query failed", "err", err.Error())
		}
	} else if platform.HasCommand("rpm") {
		out, err := platform.Run(ctx, 90*time.Second, "rpm", "-qa", "--queryformat", `%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME}\t%{SIZE}\n`)
		if err == nil {
			items = append(items, ParseRpmQuery(out)...)
		} else {
			log.Debug("rpm query failed", "err", err.Error())
		}
	}
	if platform.HasCommand("snap") {
		if out, err := platform.Run(ctx, 30*time.Second, "snap", "list"); err == nil {
			for i, l := range strings.Split(out, "\n") {
				f := strings.Fields(l)
				if i == 0 || len(f) < 5 {
					continue
				}
				s := model.Software{Name: f[0], Version: f[1], Publisher: strings.TrimSuffix(f[4], "**"), Source: "snap", PackageID: f[0]}
				s.Publisher = strings.TrimSuffix(s.Publisher, "✓")
				if strings.EqualFold(s.Publisher, "canonical") || strings.HasPrefix(strings.ToLower(s.Publisher), "canonical") {
					s.Publisher, s.Source = "Canonical", "system"
				}
				items = append(items, s)
			}
		}
	}
	if platform.HasCommand("flatpak") {
		if out, err := platform.Run(ctx, 30*time.Second, "flatpak", "list", "--app", "--columns=name,application,version,origin"); err == nil {
			for _, l := range strings.Split(out, "\n") {
				f := strings.Split(l, "\t")
				if len(f) < 2 || strings.TrimSpace(f[0]) == "" {
					continue
				}
				s := model.Software{Name: strings.TrimSpace(f[0]), PackageID: strings.TrimSpace(f[1]), Source: "flatpak"}
				if len(f) > 2 {
					s.Version = strings.TrimSpace(f[2])
				}
				if len(f) > 3 {
					s.Publisher = strings.TrimSpace(f[3])
				}
				items = append(items, s)
			}
		}
	}
	for i := range items {
		if IsProtectedPackage(items[i].Name) {
			items[i].Protected = true
		}
	}
	return items, nil
}

func collectPatches(ctx context.Context, log *slog.Logger) ([]model.Patch, error) {
	switch {
	case platform.HasCommand("apt"):
		out, err := platform.RunEnv(ctx, 120*time.Second, []string{"LANG=C", "LC_ALL=C"}, "apt", "list", "--upgradable")
		if err != nil && out == "" {
			return nil, err
		}
		return ParseAptUpgradable(out), nil
	case platform.HasCommand("dnf") || platform.HasCommand("yum"):
		bin := "dnf"
		if !platform.HasCommand("dnf") {
			bin = "yum"
		}
		list, err := platform.RunEnv(ctx, 240*time.Second, []string{"LANG=C"}, bin, "-q", "updateinfo", "list", "--updates")
		if err != nil && list == "" {
			// Older yum/dnf without --updates
			list, err = platform.RunEnv(ctx, 240*time.Second, []string{"LANG=C"}, bin, "-q", "updateinfo", "list")
			if err != nil && list == "" {
				return nil, err
			}
		}
		cves, _ := platform.RunEnv(ctx, 240*time.Second, []string{"LANG=C"}, bin, "-q", "updateinfo", "list", "--updates", "--with-cve")
		return ParseDnfUpdateinfo(list, cves), nil
	case platform.HasCommand("zypper"):
		out, err := platform.RunEnv(ctx, 240*time.Second, []string{"LANG=C"}, "zypper", "--non-interactive", "--quiet", "list-patches")
		if err != nil && out == "" {
			return nil, err
		}
		var patches []model.Patch
		for _, l := range strings.Split(out, "\n") {
			f := strings.Split(l, "|")
			if len(f) < 6 {
				continue
			}
			id := strings.TrimSpace(f[1])
			if id == "" || id == "Name" {
				continue
			}
			cat := strings.ToLower(strings.TrimSpace(f[2]))
			p := model.Patch{PatchID: id, Title: strings.TrimSpace(f[len(f)-1]), State: model.PatchMissing,
				Severity: MapMsrcSeverity(strings.TrimSpace(f[3])), Category: model.PatchCatOS}
			if cat == "security" {
				p.Category = model.PatchCatSecurity
			}
			patches = append(patches, p)
		}
		return patches, nil
	}
	log.Debug("no supported package manager for patch scan")
	return []model.Patch{}, nil
}
