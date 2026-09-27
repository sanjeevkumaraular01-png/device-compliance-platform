//go:build windows

package collector

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows/registry"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

const probeTimeout = 30 * time.Second

// WMIQuery runs a WQL query in namespace (default root\cimv2) with a timeout.
// The result is handed over only when the query completes, so a hung WMI
// provider can never corrupt caller state.
func WMIQuery[T any](ctx context.Context, timeout time.Duration, namespace, query string) ([]T, error) {
	if timeout <= 0 {
		timeout = probeTimeout
	}
	type res struct {
		v   []T
		err error
	}
	ch := make(chan res, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				ch <- res{nil, fmt.Errorf("wmi panic: %v", r)}
			}
		}()
		var dst []T
		var err error
		if namespace == "" {
			err = wmi.Query(query, &dst)
		} else {
			err = wmi.QueryNamespace(query, &dst, namespace)
		}
		// Field mismatches are non-fatal: the other fields are still loaded.
		var fm *wmi.ErrFieldMismatch
		if errors.As(err, &fm) {
			err = nil
		}
		ch <- res{dst, err}
	}()
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case r := <-ch:
		return r.v, r.err
	case <-t.C:
		return nil, fmt.Errorf("wmi query timed out: %s", query)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type win32BIOS struct {
	SerialNumber      string
	Manufacturer      string
	SMBIOSBIOSVersion string
}

type win32VideoController struct {
	Name string
}

type win32NetworkAdapterConfiguration struct {
	Description          string
	MACAddress           string
	IPAddress            []string
	DefaultIPGateway     []string
	DNSServerSearchOrder []string
	DNSDomain            string
}

type win32ComputerSystem struct {
	Manufacturer        string
	Model               string
	Domain              string
	PartOfDomain        bool
	UserName            string
	TotalPhysicalMemory uint64
	PCSystemType        uint16
	HypervisorPresent   bool
}

type win32OperatingSystem struct {
	Caption        string
	Version        string
	BuildNumber    string
	ProductType    uint32
	LastBootUpTime time.Time
}

type win32Processor struct {
	Name                      string
	NumberOfLogicalProcessors uint32
}

type win32DiskDrive struct {
	Size          uint64
	InterfaceType string
	MediaType     string
}

type win32SystemEnclosure struct {
	ChassisTypes []uint16
}

type win32Battery struct {
	Name                     string
	EstimatedChargeRemaining uint16
	BatteryStatus            uint16
}

func machineID(context.Context) string {
	if v, ok := RegString(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, "MachineGuid"); ok {
		return strings.ToUpper(v)
	}
	return ""
}

func collectHardware(ctx context.Context, log *slog.Logger) model.HardwareInfo {
	hw := model.HardwareInfo{Hostname: hostname()}
	if cn := os.Getenv("COMPUTERNAME"); cn != "" {
		hw.DeviceName = cn
	}
	if b, err := WMIQuery[win32BIOS](ctx, probeTimeout, "", "SELECT SerialNumber, Manufacturer, SMBIOSBIOSVersion FROM Win32_BIOS"); err == nil && len(b) > 0 {
		hw.SerialNumber = strings.TrimSpace(b[0].SerialNumber)
		hw.BiosVersion = strings.TrimSpace(b[0].SMBIOSBIOSVersion)
	} else if err != nil {
		log.Debug("Win32_BIOS", "err", err.Error())
	}
	var pcType uint16
	var hypervisor bool
	if cs, err := WMIQuery[win32ComputerSystem](ctx, probeTimeout, "", "SELECT Manufacturer, Model, Domain, PartOfDomain, UserName, TotalPhysicalMemory, PCSystemType, HypervisorPresent FROM Win32_ComputerSystem"); err == nil && len(cs) > 0 {
		c := cs[0]
		hw.Manufacturer = strings.TrimSpace(c.Manufacturer)
		hw.Model = strings.TrimSpace(c.Model)
		hw.RamMb = int64(c.TotalPhysicalMemory / 1024 / 1024)
		if c.PartOfDomain {
			hw.Domain = c.Domain
		}
		hw.LoggedInUser = c.UserName
		pcType, hypervisor = c.PCSystemType, c.HypervisorPresent
	} else if err != nil {
		log.Debug("Win32_ComputerSystem", "err", err.Error())
	}
	_ = hypervisor // true on any Hyper-V/VBS enabled host, not a VM indicator by itself
	serverOS := false
	if osv, err := WMIQuery[win32OperatingSystem](ctx, probeTimeout, "", "SELECT Caption, Version, BuildNumber, ProductType, LastBootUpTime FROM Win32_OperatingSystem"); err == nil && len(osv) > 0 {
		o := osv[0]
		hw.OsName = strings.TrimSpace(o.Caption)
		hw.OsVersion = o.Version
		hw.OsBuild = o.BuildNumber
		serverOS = o.ProductType == 2 || o.ProductType == 3
	}
	const cv = `SOFTWARE\Microsoft\Windows NT\CurrentVersion`
	if dv, ok := RegString(registry.LOCAL_MACHINE, cv, "DisplayVersion"); ok && dv != "" {
		hw.OsVersion = dv
		if v, _ := RegString(registry.LOCAL_MACHINE, cv, "CurrentMajorVersionNumber"); v != "" {
			minor, _ := RegString(registry.LOCAL_MACHINE, cv, "CurrentMinorVersionNumber")
			hw.OsVersion = v + "." + minor + " (" + dv + ")"
		}
	}
	if build, ok := RegString(registry.LOCAL_MACHINE, cv, "CurrentBuild"); ok {
		if ubr, ok := RegInt(registry.LOCAL_MACHINE, cv, "UBR"); ok {
			hw.OsBuild = build + "." + strconv.FormatInt(ubr, 10)
		} else {
			hw.OsBuild = build
		}
	}
	// Windows 11 still reports "Windows 10" in some registry fields; Caption is authoritative.
	if p, err := WMIQuery[win32Processor](ctx, probeTimeout, "", "SELECT Name, NumberOfLogicalProcessors FROM Win32_Processor"); err == nil && len(p) > 0 {
		hw.CPU = strings.TrimSpace(p[0].Name)
		var lp uint32
		for _, x := range p {
			lp += x.NumberOfLogicalProcessors
		}
		if lp > 0 {
			hw.CPU += fmt.Sprintf(" (%d logical CPUs)", lp)
		}
	}
	if d, err := WMIQuery[win32DiskDrive](ctx, probeTimeout, "", "SELECT Size, InterfaceType, MediaType FROM Win32_DiskDrive"); err == nil {
		var total uint64
		for _, x := range d {
			if strings.EqualFold(x.InterfaceType, "USB") || strings.Contains(strings.ToLower(x.MediaType), "removable") {
				continue
			}
			total += x.Size
		}
		hw.StorageGb = int64(total / 1_000_000_000)
	}
	var chassis []int
	if e, err := WMIQuery[win32SystemEnclosure](ctx, probeTimeout, "", "SELECT ChassisTypes FROM Win32_SystemEnclosure"); err == nil {
		for _, x := range e {
			for _, c := range x.ChassisTypes {
				chassis = append(chassis, int(c))
			}
		}
	} else {
		log.Debug("Win32_SystemEnclosure", "err", err.Error())
	}
	hasBattery := false
	if b, err := WMIQuery[win32Battery](ctx, 10*time.Second, "", "SELECT Name, EstimatedChargeRemaining, BatteryStatus FROM Win32_Battery"); err == nil && len(b) > 0 {
		hasBattery = true
		pct := int(b[0].EstimatedChargeRemaining)
		if pct > 0 && pct <= 100 {
			hw.BatteryPercent = &pct
		}
		hw.BatteryStatus = batteryStatusLabel(b[0].BatteryStatus)
	}
	// GPU (first video controller)
	if v, err := WMIQuery[win32VideoController](ctx, probeTimeout, "", "SELECT Name FROM Win32_VideoController"); err == nil && len(v) > 0 {
		var names []string
		for _, x := range v {
			if n := strings.TrimSpace(x.Name); n != "" {
				names = append(names, n)
			}
		}
		hw.Gpu = strings.Join(names, ", ")
	}
	// OS edition (e.g. Professional, Enterprise)
	if ed, ok := RegString(registry.LOCAL_MACHINE, cv, "EditionID"); ok {
		hw.OsEdition = strings.TrimSpace(ed)
	}
	// Network: gateway, DNS and per-adapter detail from IP-enabled adapters.
	collectNetworkDetail(ctx, log, &hw)
	hw.DeviceType = ClassifyDeviceType(chassis, hw.Manufacturer, hw.Model, serverOS, hasBattery || pcType == 2)
	if hw.DeviceType == model.DeviceDesktop && pcType == 3 {
		hw.DeviceType = model.DeviceWorkstation
	}
	return hw
}

func batteryStatusLabel(code uint16) string {
	switch code {
	case 1:
		return "Discharging"
	case 2:
		return "On AC"
	case 3:
		return "Fully charged"
	case 4:
		return "Low"
	case 5:
		return "Critical"
	case 6, 7, 8, 9:
		return "Charging"
	default:
		return ""
	}
}

// collectNetworkDetail fills gateway, DNS servers and the per-adapter list from
// IP-enabled network adapter configurations.
func collectNetworkDetail(ctx context.Context, log *slog.Logger, hw *model.HardwareInfo) {
	cfgs, err := WMIQuery[win32NetworkAdapterConfiguration](ctx, probeTimeout, "",
		"SELECT Description, MACAddress, IPAddress, DefaultIPGateway, DNSServerSearchOrder, DNSDomain FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = True")
	if err != nil {
		log.Debug("Win32_NetworkAdapterConfiguration", "err", err.Error())
		return
	}
	dnsSeen := map[string]bool{}
	for _, c := range cfgs {
		ad := model.NetworkAdapter{
			Name:        strings.TrimSpace(c.Description),
			MacAddress:  strings.ToLower(strings.TrimSpace(c.MACAddress)),
			IPAddresses: c.IPAddress,
			DnsSuffix:   strings.TrimSpace(c.DNSDomain),
		}
		if len(c.DefaultIPGateway) > 0 {
			ad.Gateway = c.DefaultIPGateway[0]
			if hw.Gateway == "" {
				hw.Gateway = c.DefaultIPGateway[0]
			}
		}
		for _, d := range c.DNSServerSearchOrder {
			if d = strings.TrimSpace(d); d != "" && !dnsSeen[d] {
				dnsSeen[d] = true
				hw.DnsServers = append(hw.DnsServers, d)
			}
		}
		hw.NetworkAdapters = append(hw.NetworkAdapters, ad)
	}
}

func collectServices(ctx context.Context, log *slog.Logger) []model.Service {
	rows, err := WMIQuery[win32Service](ctx, 30*time.Second, "", "SELECT Name, DisplayName, State, StartMode FROM Win32_Service")
	if err != nil {
		log.Debug("Win32_Service (inventory)", "err", err.Error())
		return nil
	}
	out := make([]model.Service, 0, len(rows))
	for _, r := range rows {
		name := strings.TrimSpace(r.Name)
		if name == "" {
			continue
		}
		out = append(out, model.Service{
			Name:        name,
			DisplayName: strings.TrimSpace(r.DisplayName),
			Status:      strings.ToUpper(strings.TrimSpace(r.State)),
			StartType:   strings.ToUpper(strings.TrimSpace(r.StartMode)),
		})
	}
	return out
}

func loggedInUser(ctx context.Context) string {
	if cs, err := WMIQuery[win32ComputerSystem](ctx, 15*time.Second, "", "SELECT UserName FROM Win32_ComputerSystem"); err == nil && len(cs) > 0 && cs[0].UserName != "" {
		return cs[0].UserName
	}
	if u := activeSessionUser(); u != "" {
		return u
	}
	if !platform.IsSystem() {
		d, u := os.Getenv("USERDOMAIN"), os.Getenv("USERNAME")
		if u != "" && d != "" {
			return d + `\` + u
		}
		return u
	}
	return ""
}

// --- security --------------------------------------------------------------

type antiVirusProduct struct {
	DisplayName            string
	ProductState           uint32
	PathToSignedProductExe string
	Timestamp              string
}

type mpComputerStatus struct {
	AMServiceEnabled              bool
	AntivirusEnabled              bool
	RealTimeProtectionEnabled     bool
	AntivirusSignatureLastUpdated time.Time
	AntivirusSignatureAge         uint32
	AMRunningMode                 string
}

type win32Service struct {
	Name        string
	DisplayName string
	State       string
	StartMode   string
}

type netFirewallProfile struct {
	Name    string
	Enabled int32
}

type encryptableVolume struct {
	DriveLetter      string
	ProtectionStatus uint32
	ConversionStatus uint32
	EncryptionMethod uint32
}

type win32Tpm struct {
	IsEnabled_InitialValue   bool //nolint:revive,stylecheck // WMI property name
	IsActivated_InitialValue bool //nolint:revive,stylecheck
	SpecVersion              string
}

type pnpEntity struct {
	Name     string
	DeviceID string
}

var bitlockerMethods = map[uint32]string{
	0: "None", 1: "AES-128 with Diffuser", 2: "AES-256 with Diffuser", 3: "AES-128", 4: "AES-256",
	5: "Hardware Encryption", 6: "XTS-AES-128", 7: "XTS-AES-256",
}

func collectSecurity(ctx context.Context, log *slog.Logger, s *model.SecurityStatus) {
	step(ctx, log, "antivirus", probeTimeout, func(ctx context.Context) (func(), error) {
		r := windowsAntivirus(ctx, log)
		return func() {
			s.AntivirusState, s.AntivirusProduct, s.AntivirusSignatureAt = r.state, r.product, r.signatureAt
			if len(r.products) > 0 {
				s.Raw["antivirusProducts"] = r.products
			}
		}, nil
	})
	step(ctx, log, "edr", probeTimeout, func(ctx context.Context) (func(), error) {
		st, prod := windowsEDR(ctx)
		return func() { s.EdrState, s.EdrProduct = st, prod }, nil
	})
	step(ctx, log, "firewall", probeTimeout, func(ctx context.Context) (func(), error) {
		st, profiles := windowsFirewall(ctx)
		return func() {
			s.FirewallState = st
			if len(profiles) > 0 {
				s.Raw["firewallProfiles"] = profiles
			}
		}, nil
	})
	step(ctx, log, "bitlocker", probeTimeout, func(ctx context.Context) (func(), error) {
		st, method, src := windowsBitLocker(ctx)
		return func() {
			s.DiskEncryptionState, s.BitlockerState, s.EncryptionMethod = st, st, method
			if method == "" && st == model.StateEnabled {
				s.EncryptionMethod = "BitLocker"
			}
			s.Raw["bitlockerSource"] = src
		}, nil
	})
	step(ctx, log, "secureboot", 10*time.Second, func(ctx context.Context) (func(), error) {
		st := model.StateUnknown
		if v, ok := RegInt(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\SecureBoot\State`, "UEFISecureBootEnabled"); ok {
			if v == 1 {
				st = model.StateEnabled
			} else {
				st = model.StateDisabled
			}
		} else if fw, ok := RegInt(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control`, "PEFirmwareType"); ok && fw == 1 {
			st = model.StateDisabled // legacy BIOS boot
		}
		return func() { s.SecureBootState = st }, nil
	})
	step(ctx, log, "tpm", probeTimeout, func(ctx context.Context) (func(), error) {
		present, detail := windowsTPM(ctx)
		return func() {
			if present != nil {
				s.TpmPresent = present
			}
			if detail != "" {
				s.Raw["tpm"] = detail
			}
		}, nil
	})
	step(ctx, log, "screenlock", 10*time.Second, func(ctx context.Context) (func(), error) {
		sl := windowsScreenLock()
		return func() {
			s.ScreenLockEnabled, s.ScreenLockTimeoutSec, s.PasswordOnWake, s.ScreenSaverEnabled = sl.enabled, sl.timeout, sl.password, sl.saver
		}, nil
	})
	step(ctx, log, "autoupdate", 10*time.Second, func(ctx context.Context) (func(), error) {
		v := windowsAutoUpdate()
		return func() { s.AutoUpdateEnabled = model.Bool(v) }, nil
	})
	step(ctx, log, "usbstorage", 10*time.Second, func(ctx context.Context) (func(), error) {
		v := WindowsUsbStorageEnabled()
		return func() { s.UsbStorageEnabled = model.Bool(v) }, nil
	})
	step(ctx, log, "reboot-boot", probeTimeout, func(ctx context.Context) (func(), error) {
		pending := RegKeyExists(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`) ||
			RegKeyExists(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`)
		var boot time.Time
		if o, err := WMIQuery[win32OperatingSystem](ctx, probeTimeout, "", "SELECT LastBootUpTime FROM Win32_OperatingSystem"); err == nil && len(o) > 0 {
			boot = o[0].LastBootUpTime
		}
		return func() {
			s.PendingRebootRequired = model.Bool(pending)
			if !boot.IsZero() {
				s.LastBootAt = model.FormatTime(boot)
			}
		}, nil
	})
}

type avResult struct {
	state, product, signatureAt string
	products                    []map[string]any
}

func windowsAntivirus(ctx context.Context, log *slog.Logger) avResult {
	r := avResult{state: model.StateUnknown}
	prods, scErr := WMIQuery[antiVirusProduct](ctx, probeTimeout, `root\SecurityCenter2`, "SELECT displayName, productState, pathToSignedProductExe, timestamp FROM AntiVirusProduct")
	var mp *mpComputerStatus
	if st, err := WMIQuery[mpComputerStatus](ctx, probeTimeout, `root\Microsoft\Windows\Defender`,
		"SELECT AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated, AntivirusSignatureAge, AMRunningMode FROM MSFT_MpComputerStatus"); err == nil && len(st) > 0 {
		mp = &st[0]
	} else if err != nil {
		log.Debug("MSFT_MpComputerStatus", "err", err.Error())
	}
	if scErr == nil && len(prods) > 0 {
		var enabled, outdated, all []string
		for _, p := range prods {
			d := DecodeAVProductState(p.ProductState)
			r.products = append(r.products, map[string]any{
				"name": p.DisplayName, "productState": p.ProductState, "enabled": d.Enabled, "upToDate": d.UpToDate,
			})
			all = append(all, p.DisplayName)
			switch ProtectionFromAV(d) {
			case model.StateEnabled:
				enabled = append(enabled, p.DisplayName)
			case model.StateOutdated:
				outdated = append(outdated, p.DisplayName)
			}
		}
		switch {
		case len(enabled) > 0:
			r.state, r.product = model.StateEnabled, strings.Join(enabled, ", ")
		case len(outdated) > 0:
			r.state, r.product = model.StateOutdated, strings.Join(outdated, ", ")
		default:
			r.state, r.product = model.StateDisabled, strings.Join(all, ", ")
		}
		if mp != nil && strings.Contains(strings.ToLower(r.product), "defender") && !mp.AntivirusSignatureLastUpdated.IsZero() {
			r.signatureAt = model.FormatTime(mp.AntivirusSignatureLastUpdated)
		}
		return r
	}
	// Server SKUs have no Security Center: rely on Defender status.
	if mp != nil {
		r.product = "Microsoft Defender Antivirus"
		switch {
		case !mp.AMServiceEnabled || !mp.AntivirusEnabled || !mp.RealTimeProtectionEnabled:
			r.state = model.StateDisabled
		case mp.AntivirusSignatureAge > 7:
			r.state = model.StateOutdated
		default:
			r.state = model.StateEnabled
		}
		if !mp.AntivirusSignatureLastUpdated.IsZero() {
			r.signatureAt = model.FormatTime(mp.AntivirusSignatureLastUpdated)
		}
		return r
	}
	if scErr == nil {
		r.state = model.StateNotInstalled
	}
	return r
}

func windowsEDR(ctx context.Context) (string, string) {
	var names []string
	for _, p := range EDRCatalog {
		for _, s := range p.Services {
			if !strings.ContainsAny(s, "/. ") {
				names = append(names, "Name='"+s+"'")
			}
		}
	}
	svcs, err := WMIQuery[win32Service](ctx, probeTimeout, "", "SELECT Name, State FROM Win32_Service WHERE "+strings.Join(names, " OR "))
	if err != nil {
		return model.StateUnknown, ""
	}
	running, installed := map[string]bool{}, map[string]bool{}
	for _, s := range svcs {
		n := strings.ToLower(s.Name)
		installed[n] = true
		if strings.EqualFold(s.State, "Running") {
			running[n] = true
		}
	}
	// The Defender for Endpoint "Sense" service ships with Windows; it only
	// counts when the device is onboarded.
	if !running["sense"] {
		if v, ok := RegInt(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows Advanced Threat Protection\Status`, "OnboardingState"); !ok || v != 1 {
			delete(installed, "sense")
		}
	}
	var det []DetectResult
	for _, p := range EDRCatalog {
		isRun, isInst := false, false
		for _, s := range p.Services {
			ls := strings.ToLower(s)
			isRun = isRun || running[ls]
			isInst = isInst || installed[ls]
		}
		if isRun || isInst {
			det = append(det, DetectResult{Product: p.Name, Running: isRun})
		}
	}
	return StateFromDetections(det)
}

func windowsFirewall(ctx context.Context) (string, map[string]bool) {
	profiles := map[string]bool{}
	if fw, err := WMIQuery[netFirewallProfile](ctx, probeTimeout, `root\StandardCimv2`, "SELECT Name, Enabled FROM MSFT_NetFirewallProfile"); err == nil && len(fw) > 0 {
		for _, p := range fw {
			profiles[p.Name] = p.Enabled == 1
		}
	} else {
		const base = `SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\`
		for name, key := range map[string]string{"Domain": "DomainProfile", "Private": "StandardProfile", "Public": "PublicProfile"} {
			if v, ok := RegInt(registry.LOCAL_MACHINE, base+key, "EnableFirewall"); ok {
				profiles[name] = v == 1
			}
		}
		// Group Policy overrides
		const gpo = `SOFTWARE\Policies\Microsoft\WindowsFirewall\`
		for name, key := range map[string]string{"Domain": "DomainProfile", "Private": "PrivateProfile", "Public": "PublicProfile"} {
			if v, ok := RegInt(registry.LOCAL_MACHINE, gpo+key, "EnableFirewall"); ok {
				profiles[name] = v == 1
			}
		}
	}
	if len(profiles) == 0 {
		return model.StateUnknown, nil
	}
	for _, on := range profiles {
		if !on {
			return model.StateDisabled, profiles
		}
	}
	return model.StateEnabled, profiles
}

func windowsBitLocker(ctx context.Context) (string, string, string) {
	sysDrive := os.Getenv("SystemDrive")
	if sysDrive == "" {
		sysDrive = "C:"
	}
	vols, err := WMIQuery[encryptableVolume](ctx, probeTimeout, `root\CIMV2\Security\MicrosoftVolumeEncryption`,
		"SELECT DriveLetter, ProtectionStatus, ConversionStatus, EncryptionMethod FROM Win32_EncryptableVolume")
	if err == nil {
		for _, v := range vols {
			if !strings.EqualFold(v.DriveLetter, sysDrive) {
				continue
			}
			method := bitlockerMethods[v.EncryptionMethod]
			switch {
			case v.ProtectionStatus == 1:
				return model.StateEnabled, method, "wmi"
			case v.ConversionStatus == 1 || v.ConversionStatus == 2:
				// Fully encrypted (or encrypting) but protection suspended/off.
				return model.StateDisabled, method, "wmi"
			default:
				return model.StateDisabled, "", "wmi"
			}
		}
		return model.StateUnknown, "", "wmi"
	}
	// Win32_EncryptableVolume requires administrator rights. The shell
	// property System.Volume.BitLockerProtection is readable by any user.
	v, serr := ShellBitLockerProtection(sysDrive + `\`)
	if serr == nil {
		switch v {
		case 1, 3, 6: // on, encrypting, on+locked
			return model.StateEnabled, "", "shell"
		case 5:
			return model.StateDisabled, "BitLocker (suspended)", "shell"
		case 7:
			// Device Encryption: data encrypted with a clear key, protectors not
			// yet active ("waiting for activation") => not protected.
			return model.StateDisabled, "Device Encryption (waiting for activation)", "shell"
		case 0, 2, 4:
			return model.StateDisabled, "", "shell"
		}
		return model.StateUnknown, "", fmt.Sprintf("shell:%d", v)
	}
	return model.StateUnknown, "", "unavailable: " + serr.Error()
}

func windowsTPM(ctx context.Context) (*bool, string) {
	if t, err := WMIQuery[win32Tpm](ctx, probeTimeout, `root\CIMV2\Security\MicrosoftTpm`, "SELECT IsEnabled_InitialValue, IsActivated_InitialValue, SpecVersion FROM Win32_Tpm"); err == nil {
		if len(t) == 0 {
			return model.Bool(false), ""
		}
		v := t[0].SpecVersion
		if i := strings.Index(v, ","); i > 0 {
			v = v[:i]
		}
		return model.Bool(t[0].IsEnabled_InitialValue), "TPM " + v
	}
	// Non-admin fallback: look for the TPM PnP device.
	if d, err := WMIQuery[pnpEntity](ctx, probeTimeout, "", "SELECT Name, DeviceID FROM Win32_PnPEntity WHERE PNPClass='SecurityDevices'"); err == nil {
		for _, x := range d {
			if strings.Contains(strings.ToLower(x.Name), "trusted platform module") || strings.HasPrefix(strings.ToUpper(x.DeviceID), `ACPI\MSFT0101`) {
				return model.Bool(true), strings.TrimSpace(x.Name)
			}
		}
		return model.Bool(false), ""
	}
	return nil, ""
}

type screenLockInfo struct {
	enabled, password, saver *bool
	timeout                  *int
}

func windowsScreenLock() screenLockInfo {
	var info screenLockInfo
	// Machine-wide "Interactive logon: Machine inactivity limit".
	inactivity, hasInactivity := RegInt(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`, "InactivityTimeoutSecs")
	// Screen saver of the logged-on users (policy value wins over user value).
	saverActive, saverSecure, saverTimeout := false, false, 0
	found := false
	for _, sid := range LoadedUserSIDs() {
		get := func(name string) (string, bool) {
			if v, ok := RegString(registry.USERS, sid+`\Software\Policies\Microsoft\Windows\Control Panel\Desktop`, name); ok {
				return v, true
			}
			return RegString(registry.USERS, sid+`\Control Panel\Desktop`, name)
		}
		a, okA := get("ScreenSaveActive")
		sec, _ := get("ScreenSaverIsSecure")
		to, _ := get("ScreenSaveTimeOut")
		exe, hasExe := get("SCRNSAVE.EXE")
		if !okA && !hasExe {
			continue
		}
		found = true
		// The screen saver only runs when one is selected (SCRNSAVE.EXE).
		active := a == "1" && hasExe && strings.TrimSpace(exe) != ""
		t, _ := strconv.Atoi(strings.TrimSpace(to))
		// Report the weakest user configuration.
		if !saverActive || !active || t > saverTimeout {
			saverActive, saverSecure, saverTimeout = active, sec == "1", t
		}
	}
	switch {
	case hasInactivity && inactivity > 0:
		info.enabled, info.password, info.timeout = model.Bool(true), model.Bool(true), model.Int(int(inactivity))
		info.saver = model.Bool(saverActive)
		if saverActive && saverSecure && saverTimeout > 0 && saverTimeout < int(inactivity) {
			info.timeout = model.Int(saverTimeout)
		}
	case found:
		info.saver = model.Bool(saverActive)
		info.password = model.Bool(saverSecure)
		info.enabled = model.Bool(saverActive && saverSecure && saverTimeout > 0)
		info.timeout = model.Int(saverTimeout)
	default:
		info.enabled = model.Bool(false)
	}
	return info
}

func windowsAutoUpdate() bool {
	const au = `SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`
	if v, ok := RegInt(registry.LOCAL_MACHINE, au, "NoAutoUpdate"); ok && v == 1 {
		return false
	}
	if v, ok := RegInt(registry.LOCAL_MACHINE, au, "AUOptions"); ok && v == 1 {
		return false
	}
	if v, ok := RegInt(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\wuauserv`, "Start"); ok && v == 4 {
		return false
	}
	return true // Windows Update is automatic unless disabled by policy
}

// WindowsUsbStorageEnabled reports whether USB mass storage can be used.
func WindowsUsbStorageEnabled() bool {
	if v, ok := RegInt(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\USBSTOR`, "Start"); ok && v == 4 {
		return false
	}
	if v, ok := RegInt(registry.LOCAL_MACHINE, `SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices`, "Deny_All"); ok && v == 1 {
		return false
	}
	for _, name := range []string{"Deny_Read", "Deny_Write", "Deny_Execute"} {
		if v, ok := RegInt(registry.LOCAL_MACHINE, `SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}`, name); ok && v == 1 && name == "Deny_Read" {
			return false
		}
	}
	return true
}

// --- software -----------------------------------------------------------------

const uninstallPath = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`

func collectSoftware(ctx context.Context, log *slog.Logger) ([]model.Software, error) {
	var items []model.Software
	read := func(root registry.Key, path string, access uint32, source string) {
		k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|access)
		if err != nil {
			return
		}
		defer k.Close()
		subs, err := k.ReadSubKeyNames(-1)
		if err != nil {
			return
		}
		for _, sub := range subs {
			sk, err := registry.OpenKey(root, path+`\`+sub, registry.QUERY_VALUE|access)
			if err != nil {
				continue
			}
			name, _ := regValueString(sk, "DisplayName")
			if strings.TrimSpace(name) == "" {
				sk.Close()
				continue
			}
			if v, ok := regValueString(sk, "SystemComponent"); ok && v == "1" {
				sk.Close()
				continue
			}
			if v, ok := regValueString(sk, "ParentKeyName"); ok && v != "" {
				sk.Close()
				continue
			}
			if v, _ := regValueString(sk, "ReleaseType"); v == "Update" || v == "Hotfix" || v == "Security Update" {
				sk.Close()
				continue
			}
			s := model.Software{Name: strings.TrimSpace(name), Source: source, PackageID: sub}
			s.Version, _ = regValueString(sk, "DisplayVersion")
			s.Publisher, _ = regValueString(sk, "Publisher")
			s.Publisher = strings.TrimSpace(s.Publisher)
			s.InstallLocation, _ = regValueString(sk, "InstallLocation")
			s.UninstallString, _ = regValueString(sk, "UninstallString")
			s.QuietUninstallString, _ = regValueString(sk, "QuietUninstallString")
			if d, ok := regValueString(sk, "InstallDate"); ok && len(d) == 8 {
				if t, err := time.Parse("20060102", d); err == nil {
					s.InstallDate = model.FormatTime(t)
				}
			}
			if kb, _, err := sk.GetIntegerValue("EstimatedSize"); err == nil && kb > 0 {
				s.SizeMb = round2(float64(kb) / 1024)
			}
			if wi, ok := regValueString(sk, "WindowsInstaller"); ok && wi == "1" && strings.HasPrefix(sub, "{") && s.UninstallString == "" {
				s.UninstallString = "MsiExec.exe /X" + sub
			}
			if strings.EqualFold(s.Publisher, "Microsoft Corporation") && (strings.HasPrefix(s.Name, "Microsoft Visual C++") || strings.HasPrefix(s.Name, "Windows ") || strings.Contains(s.Name, "Update Health Tools")) {
				s.Source = "system"
			}
			if strings.Contains(strings.ToLower(s.Name), "secureendpoint") {
				s.Protected = true
			}
			sk.Close()
			items = append(items, s)
		}
	}
	read(registry.LOCAL_MACHINE, uninstallPath, registry.WOW64_64KEY, "registry")
	read(registry.LOCAL_MACHINE, uninstallPath, registry.WOW64_32KEY, "registry")
	for _, sid := range LoadedUserSIDs() {
		read(registry.USERS, sid+`\`+uninstallPath, 0, "user")
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no uninstall entries readable")
	}
	_ = ctx
	_ = log
	return items, nil
}

// --- patches ------------------------------------------------------------------

type win32QFE struct {
	HotFixID    string
	Description string
	InstalledOn string
}

func collectPatches(ctx context.Context, log *slog.Logger) ([]model.Patch, error) {
	var patches []model.Patch
	seen := map[string]bool{}
	qfe, err := WMIQuery[win32QFE](ctx, 90*time.Second, "", "SELECT HotFixID, Description, InstalledOn FROM Win32_QuickFixEngineering")
	if err != nil {
		log.Debug("Win32_QuickFixEngineering", "err", err.Error())
	}
	for _, q := range qfe {
		id := strings.TrimSpace(q.HotFixID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		cat := model.PatchCatOS
		sev := model.SevUnspecified
		if strings.Contains(strings.ToLower(q.Description), "security") {
			cat = model.PatchCatSecurity
		}
		patches = append(patches, model.Patch{
			PatchID: id, Title: strings.TrimSpace(q.Description + " " + id), Category: cat, Severity: sev,
			State: model.PatchInstalled, Product: "Windows", InstalledAt: ParseQFEDate(q.InstalledOn),
		})
	}
	missing, werr := SearchWindowsUpdates(ctx, "IsInstalled=0 and Type='Software' and IsHidden=0")
	if werr != nil {
		log.Warn("Windows Update search failed", "err", werr.Error())
	}
	for _, u := range missing {
		id := u.PatchID()
		if seen[id] {
			continue
		}
		seen[id] = true
		st := model.PatchMissing
		if u.IsDownloaded {
			st = model.PatchPendingInstall
		}
		p := model.Patch{
			PatchID: id, Title: u.Title, Category: MapWUCategory(u.Categories, u.Title), Severity: MapMsrcSeverity(u.MsrcSeverity),
			State: st, CveIDs: u.CveIDs, Product: strings.Join(u.Products, ", "),
		}
		if !u.ReleasedAt.IsZero() {
			p.ReleasedAt = model.FormatTime(u.ReleasedAt)
		}
		patches = append(patches, p)
	}
	sort.SliceStable(patches, func(i, j int) bool { return patches[i].State > patches[j].State })
	if err != nil && werr != nil {
		return patches, fmt.Errorf("qfe: %v; wua: %v", err, werr)
	}
	return patches, nil
}
