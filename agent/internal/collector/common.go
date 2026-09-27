package collector

import (
	"net"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/secureendpoint/agent/internal/model"
)

func hostname() string {
	h, _ := os.Hostname()
	return h
}

// archLabel returns a human-friendly CPU architecture label.
func archLabel() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x64"
	case "386":
		return "x86"
	case "arm64":
		return "arm64"
	case "arm":
		return "arm"
	default:
		return runtime.GOARCH
	}
}

// virtualIfacePrefixes are skipped when choosing MAC addresses.
var virtualIfacePrefixes = []string{
	"docker", "veth", "br-", "virbr", "vmnet", "vboxnet", "tun", "tap", "wg", "utun",
	"awdl", "llw", "bridge", "ap", "anpi", "gif", "stf", "cni", "flannel", "cali", "kube",
	"vethernet", "zt", "tailscale", "isatap", "teredo",
}

func isVirtualIface(name string) bool {
	n := strings.ToLower(name)
	for _, p := range virtualIfacePrefixes {
		if strings.HasPrefix(n, p) {
			return true
		}
	}
	return strings.Contains(n, "virtual") || strings.Contains(n, "pseudo") || strings.Contains(n, "loopback") ||
		strings.Contains(n, "bluetooth") || strings.Contains(n, "hyper-v") || strings.Contains(n, "vmware") || strings.Contains(n, "virtualbox")
}

var virtualOUIs = []string{"00:50:56", "00:0C:29", "00:05:69", "00:1C:14", "08:00:27", "0A:00:27", "00:15:5D", "00:1C:42", "52:54:00"}

func isVirtualOUI(mac string) bool {
	for _, o := range virtualOUIs {
		if strings.HasPrefix(mac, o) {
			return true
		}
	}
	return false
}

// fillNetwork sets the primary IPv4 address and physical MAC addresses.
func fillNetwork(hw *model.HardwareInfo) {
	if hw.IPAddress == "" {
		hw.IPAddress = primaryIP()
	}
	if len(hw.MacAddresses) > 0 {
		return
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	seen := map[string]bool{}
	var macs []string
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 || len(ifc.HardwareAddr) != 6 || isVirtualIface(ifc.Name) {
			continue
		}
		mac := strings.ToUpper(ifc.HardwareAddr.String())
		if mac == "00:00:00:00:00:00" || seen[mac] {
			continue
		}
		// Skip locally administered (randomised / virtual) addresses and
		// well-known hypervisor OUIs (VMware, VirtualBox, Hyper-V, Parallels, QEMU).
		if ifc.HardwareAddr[0]&0x02 != 0 || isVirtualOUI(mac) {
			continue
		}
		seen[mac] = true
		macs = append(macs, mac)
	}
	sort.Strings(macs)
	hw.MacAddresses = macs
}

// primaryIP returns the source address the OS would use to reach the
// internet (no packets are sent), falling back to the first global IPv4.
func primaryIP() string {
	if c, err := net.Dial("udp", "192.0.2.1:9"); err == nil { // TEST-NET-1, never routed
		defer c.Close()
		if a, ok := c.LocalAddr().(*net.UDPAddr); ok && !a.IP.IsLoopback() && !a.IP.IsUnspecified() {
			return a.IP.String()
		}
	}
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && ipn.IP.IsGlobalUnicast() {
				return ipn.IP.String()
			}
		}
	}
	return ""
}

// SMBIOS chassis types.
var (
	laptopChassis  = map[int]bool{8: true, 9: true, 10: true, 11: true, 14: true, 30: true, 31: true, 32: true}
	serverChassis  = map[int]bool{17: true, 23: true, 25: true, 28: true, 29: true}
	desktopChassis = map[int]bool{3: true, 4: true, 5: true, 6: true, 7: true, 13: true, 15: true, 16: true, 24: true, 34: true, 35: true, 36: true}
)

var vmMarkers = []string{
	"vmware", "virtualbox", "vbox", "kvm", "qemu", "xen", "hvm domu", "virtual machine", "parallels",
	"bochs", "amazon ec2", "google compute engine", "openstack", "bhyve", "hyper-v", "virtualmac", "utm",
	"cloud hypervisor", "nutanix", "droplet", "linode", "digitalocean", "hetzner vserver", "ovirt", "proxmox",
}

// IsVirtualMachine applies marker heuristics to manufacturer / model strings.
func IsVirtualMachine(fields ...string) bool {
	for _, f := range fields {
		l := strings.ToLower(f)
		if l == "" {
			continue
		}
		for _, m := range vmMarkers {
			if strings.Contains(l, m) {
				return true
			}
		}
	}
	return false
}

var workstationModels = []string{"precision", "z workstation", "zbook studio", "thinkstation", "celsius", "mac pro", "hp z"}

// ClassifyDeviceType guesses the DeviceType from SMBIOS chassis types,
// manufacturer/model strings, server-OS and battery presence.
func ClassifyDeviceType(chassis []int, manufacturer, modelName string, serverOS, hasBattery bool) string {
	if IsVirtualMachine(manufacturer, modelName) {
		return model.DeviceVM
	}
	for _, c := range chassis {
		if serverChassis[c] {
			return model.DeviceServer
		}
	}
	for _, c := range chassis {
		if laptopChassis[c] {
			return model.DeviceLaptop
		}
	}
	if serverOS {
		return model.DeviceServer
	}
	lm := strings.ToLower(modelName)
	if strings.Contains(lm, "macbook") || strings.Contains(lm, "laptop") || strings.Contains(lm, "notebook") || strings.Contains(lm, "thinkpad") {
		return model.DeviceLaptop
	}
	for _, w := range workstationModels {
		if strings.Contains(lm, w) && !strings.Contains(lm, "mobile") {
			return model.DeviceWorkstation
		}
	}
	for _, c := range chassis {
		if desktopChassis[c] {
			return model.DeviceDesktop
		}
	}
	if hasBattery {
		return model.DeviceLaptop
	}
	if strings.Contains(lm, "imac") || strings.Contains(lm, "macmini") || strings.Contains(lm, "mac mini") || strings.Contains(lm, "mac studio") || strings.Contains(lm, "macstudio") {
		return model.DeviceDesktop
	}
	if len(chassis) > 0 {
		return model.DeviceDesktop
	}
	return model.DeviceOther
}

// --- Windows Security Center productState decoding ----------------------

// AVProductState is the decoded SecurityCenter2 productState bitmask.
type AVProductState struct {
	Enabled    bool // real-time protection on
	UpToDate   bool // signatures current
	Snoozed    bool
	Expired    bool
	ThirdParty bool // not a Microsoft product
}

// DecodeAVProductState decodes the WSC productState DWORD:
//
//	bits 16-23: product owner/type flags
//	bits 12-15: scanner state (0x0 off, 0x1 on, 0x2 snoozed, 0x3 expired)
//	bits  4-7 : signature state (0x0 up to date, 0x1 out of date)
func DecodeAVProductState(state uint32) AVProductState {
	scanner := (state >> 12) & 0xF
	sig := (state >> 4) & 0xF
	owner := (state >> 8) & 0xF
	return AVProductState{
		Enabled:    scanner == 0x1,
		Snoozed:    scanner == 0x2,
		Expired:    scanner == 0x3,
		UpToDate:   sig == 0x0,
		ThirdParty: owner == 0x0,
	}
}

// ProtectionFromAV maps a decoded AV state to a ProtectionState.
func ProtectionFromAV(s AVProductState) string {
	switch {
	case !s.Enabled:
		return model.StateDisabled
	case !s.UpToDate:
		return model.StateOutdated
	default:
		return model.StateEnabled
	}
}

// --- EDR / AV catalogs -----------------------------------------------------

// Product identifies a security product by its services / processes / paths.
type Product struct {
	Name      string
	Services  []string // Windows service names / systemd units / launchd labels
	Processes []string // process names (Linux comm, macOS executable)
	Paths     []string // install paths (existence => installed)
	IsAV      bool     // also provides anti-malware
}

// EDRCatalog lists the EDR agents the collector detects.
var EDRCatalog = []Product{
	{Name: "CrowdStrike Falcon", Services: []string{"CSFalconService", "falcon-sensor"}, Processes: []string{"falcond", "falcon-sensor", "com.crowdstrike.falcon.Agent"}, Paths: []string{"/opt/CrowdStrike", "/Applications/Falcon.app"}, IsAV: true},
	{Name: "SentinelOne", Services: []string{"SentinelAgent", "sentinelone"}, Processes: []string{"SentinelAgent", "s1-agent", "sentinelone-agent", "sentineld"}, Paths: []string{"/opt/sentinelone", "/Applications/SentinelOne"}, IsAV: true},
	{Name: "Microsoft Defender for Endpoint", Services: []string{"Sense", "MsSense", "mdatp"}, Processes: []string{"wdavdaemon", "MsSense"}, Paths: []string{"/opt/microsoft/mdatp", "/Applications/Microsoft Defender.app"}, IsAV: true},
	{Name: "Cylance", Services: []string{"CylanceSvc", "cylancesvc"}, Processes: []string{"cylancesvc", "CylanceSvc"}, Paths: []string{"/opt/cylance"}, IsAV: true},
	{Name: "VMware Carbon Black", Services: []string{"CbDefense", "CarbonBlack", "cbdaemon", "cbagentd", "cb-psc-sensor"}, Processes: []string{"cbagentd", "cbdaemon", "cbdefense", "CbOsxSensorService"}, Paths: []string{"/opt/carbonblack", "/Applications/VMware Carbon Black Cloud"}, IsAV: true},
	{Name: "Sophos Endpoint", Services: []string{"Sophos Endpoint Defense Service", "SAVService", "SophosED", "sophos-spl"}, Processes: []string{"sophos_threat_detector", "SophosScanD", "SophosMDR", "sophosav"}, Paths: []string{"/opt/sophos-spl", "/Applications/Sophos"}, IsAV: true},
	{Name: "Palo Alto Cortex XDR", Services: []string{"cyserver", "CyveraService", "traps_pmd", "traps"}, Processes: []string{"cyserver", "pmd", "traps_pmd", "cortex-xdr"}, Paths: []string{"/opt/traps", "/Library/Application Support/PaloAltoNetworks/Traps"}, IsAV: true},
	{Name: "Trend Micro Apex One / Deep Security", Services: []string{"ds_agent", "TmCCSF", "Trend Micro Endpoint Basecamp"}, Processes: []string{"ds_agent", "TmccMac"}, Paths: []string{"/opt/ds_agent"}, IsAV: true},
	{Name: "Elastic Defend", Services: []string{"ElasticEndpoint", "elastic-endpoint", "ElasticEndpoint.service"}, Processes: []string{"elastic-endpoint"}, Paths: []string{"/opt/Elastic/Endpoint"}, IsAV: true},
	{Name: "Trellix / McAfee ENS", Services: []string{"mfemms", "McAfeeFramework", "mfetp"}, Processes: []string{"mfetpd", "mfeespd"}, Paths: []string{"/opt/McAfee", "/opt/isec"}, IsAV: true},
	{Name: "ESET Inspect", Services: []string{"EraAgentSvc", "ekrn", "eea"}, Processes: []string{"eea", "ekrn"}, Paths: []string{"/opt/eset"}, IsAV: true},
	{Name: "Jamf Protect", Services: []string{"com.jamf.protect.daemon"}, Processes: []string{"JamfProtect"}, Paths: []string{"/Applications/JamfProtect.app"}, IsAV: true},
	{Name: "Huntress", Services: []string{"HuntressAgent", "HuntressRio"}, Processes: []string{"HuntressAgent"}, Paths: []string{"/Library/Application Support/Huntress"}},
	{Name: "Cisco Secure Endpoint", Services: []string{"CiscoAMP", "cisco-amp"}, Processes: []string{"ampdaemon", "sfc"}, Paths: []string{"/opt/cisco/amp"}, IsAV: true},
	{Name: "Wazuh Agent", Services: []string{"WazuhSvc", "wazuh-agent"}, Processes: []string{"wazuh-agentd"}, Paths: []string{"/var/ossec/bin/wazuh-agentd"}},
}

// AVCatalog lists anti-malware products without EDR capabilities (Linux/macOS).
var AVCatalog = []Product{
	{Name: "ClamAV", Services: []string{"clamav-daemon", "clamd@scan", "clamd"}, Processes: []string{"clamd"}, Paths: []string{"/usr/bin/clamscan", "/usr/sbin/clamd", "/opt/homebrew/bin/clamscan", "/usr/local/bin/clamscan"}, IsAV: true},
	{Name: "ESET Endpoint Antivirus", Services: []string{"eset_rtp", "esets"}, Processes: []string{"esets_daemon", "esets_proxy"}, Paths: []string{"/opt/eset/esets", "/Applications/ESET Endpoint Antivirus.app"}, IsAV: true},
	{Name: "Bitdefender Endpoint Security", Services: []string{"bdsec"}, Processes: []string{"bdsecd", "BDLDaemon"}, Paths: []string{"/opt/bitdefender-security-tools", "/Library/Bitdefender"}, IsAV: true},
	{Name: "Kaspersky Endpoint Security", Services: []string{"kesl"}, Processes: []string{"kesl", "klnagent"}, Paths: []string{"/opt/kaspersky"}, IsAV: true},
	{Name: "Malwarebytes", Services: []string{"MBAMService"}, Processes: []string{"RTProtectionDaemon"}, Paths: []string{"/Library/Application Support/Malwarebytes"}, IsAV: true},
}

// DetectResult is the outcome of MatchProducts.
type DetectResult struct {
	Product string
	Running bool
}

// MatchProducts returns the catalog products that are running (process list
// or running services) or merely installed (path exists).
func MatchProducts(catalog []Product, running map[string]bool, pathExists func(string) bool) []DetectResult {
	var out []DetectResult
	for _, p := range catalog {
		isRunning := false
		for _, n := range append(append([]string{}, p.Processes...), p.Services...) {
			if running[strings.ToLower(n)] {
				isRunning = true
				break
			}
		}
		installed := isRunning
		if !installed && pathExists != nil {
			for _, path := range p.Paths {
				if pathExists(path) {
					installed = true
					break
				}
			}
		}
		if installed {
			out = append(out, DetectResult{Product: p.Name, Running: isRunning})
		}
	}
	return out
}

// StateFromDetections turns detections into a ProtectionState + product list.
func StateFromDetections(d []DetectResult) (string, string) {
	if len(d) == 0 {
		return model.StateNotInstalled, ""
	}
	var runningNames, allNames []string
	for _, x := range d {
		allNames = append(allNames, x.Product)
		if x.Running {
			runningNames = append(runningNames, x.Product)
		}
	}
	if len(runningNames) > 0 {
		return model.StateEnabled, strings.Join(runningNames, ", ")
	}
	return model.StateDisabled, strings.Join(allNames, ", ")
}

func lowerSet(names []string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, n := range names {
		m[strings.ToLower(strings.TrimSpace(n))] = true
	}
	return m
}
