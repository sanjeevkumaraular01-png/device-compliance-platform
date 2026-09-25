package collector

import (
	"testing"

	"github.com/secureendpoint/agent/internal/model"
)

func TestDecodeAVProductState(t *testing.T) {
	cases := []struct {
		state      uint32
		want       string
		thirdParty bool
	}{
		{397568, model.StateEnabled, false},  // 0x61100 Defender on, up to date
		{397584, model.StateOutdated, false}, // 0x61110 on, signatures out of date
		{393472, model.StateDisabled, false}, // 0x60100 off
		{266240, model.StateEnabled, true},   // 0x41000 third-party on
		{262144, model.StateDisabled, true},  // 0x40000 third-party off
		{397312, model.StateEnabled, true},   // 0x61000
		{401664, model.StateDisabled, false}, // 0x62100 snoozed
	}
	for _, c := range cases {
		d := DecodeAVProductState(c.state)
		if got := ProtectionFromAV(d); got != c.want {
			t.Errorf("state %d (0x%X): got %s want %s", c.state, c.state, got, c.want)
		}
		if d.ThirdParty != c.thirdParty {
			t.Errorf("state %d: thirdParty=%v want %v", c.state, d.ThirdParty, c.thirdParty)
		}
	}
	if !DecodeAVProductState(401664).Snoozed {
		t.Error("0x62100 should be snoozed")
	}
}

func TestParseLsblkRootEncryption(t *testing.T) {
	luks := `{"blockdevices":[{"name":"nvme0n1","type":"disk","fstype":null,"mountpoint":null,"children":[
	 {"name":"nvme0n1p1","type":"part","fstype":"vfat","mountpoint":"/boot/efi"},
	 {"name":"nvme0n1p3","type":"part","fstype":"crypto_LUKS","mountpoint":null,"children":[
	   {"name":"dm_crypt-0","type":"crypt","fstype":"LVM2_member","mountpoint":null,"children":[
	     {"name":"ubuntu--vg-ubuntu--lv","type":"lvm","fstype":"ext4","mountpoint":"/"}]}]}]}]}`
	if s, m := ParseLsblkRootEncryption([]byte(luks)); s != model.StateEnabled || m != "LUKS" {
		t.Fatalf("luks: %s %s", s, m)
	}
	plain := `{"blockdevices":[{"name":"sda","type":"disk","fstype":null,"mountpoints":[null],"children":[
	 {"name":"sda1","type":"part","fstype":"ext4","mountpoints":["/"]}]}]}`
	if s, _ := ParseLsblkRootEncryption([]byte(plain)); s != model.StateDisabled {
		t.Fatalf("plain: %s", s)
	}
	container := `{"blockdevices":[{"name":"sda","type":"disk","fstype":null,"mountpoint":null}]}`
	if s, _ := ParseLsblkRootEncryption([]byte(container)); s != model.StateUnknown {
		t.Fatalf("container: %s", s)
	}
	if s, _ := ParseLsblkRootEncryption([]byte("garbage")); s != model.StateUnknown {
		t.Fatalf("garbage: %s", s)
	}
}

func TestParseAptUpgradable(t *testing.T) {
	out := `Listing... Done
openssl/jammy-updates,jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]
vim/jammy-updates 2:8.2.3995-1ubuntu2.17 amd64 [upgradable from: 2:8.2.3995-1ubuntu2.16]
`
	p := ParseAptUpgradable(out)
	if len(p) != 2 {
		t.Fatalf("got %d patches", len(p))
	}
	if p[0].PatchID != "apt:openssl:3.0.2-0ubuntu1.15" || p[0].Category != model.PatchCatSecurity || p[0].Severity != model.SevImportant || p[0].State != model.PatchMissing {
		t.Fatalf("openssl: %+v", p[0])
	}
	if p[1].Category != model.PatchCatOS || p[1].Severity != model.SevUnspecified {
		t.Fatalf("vim: %+v", p[1])
	}
	pkg, ver, ok := ParseAptPatchID(p[1].PatchID)
	if !ok || pkg != "vim" || ver != "2:8.2.3995-1ubuntu2.17" {
		t.Fatalf("ParseAptPatchID: %q %q %v", pkg, ver, ok)
	}
}

func TestParseDnfUpdateinfo(t *testing.T) {
	list := `RHSA-2024:1234 Important/Sec. openssl-1:3.0.7-25.el9_3.x86_64
RHSA-2024:1234 Important/Sec. openssl-libs-1:3.0.7-25.el9_3.x86_64
RHSA-2024:2000 Critical/Sec.  kernel-5.14.0-362.24.1.el9_3.x86_64
RHBA-2024:3000 bugfix         tzdata-2024a-1.el9.noarch
`
	cves := `CVE-2023-5678 Important/Sec. openssl-1:3.0.7-25.el9_3.x86_64
CVE-2024-0001 Critical/Sec.  kernel-5.14.0-362.24.1.el9_3.x86_64
`
	p := ParseDnfUpdateinfo(list, cves)
	if len(p) != 3 {
		t.Fatalf("got %d", len(p))
	}
	if p[0].PatchID != "RHSA-2024:1234" || p[0].Severity != model.SevImportant || p[0].Category != model.PatchCatSecurity || len(p[0].CveIDs) != 1 {
		t.Fatalf("p0 %+v", p[0])
	}
	if p[1].Severity != model.SevCritical || p[1].CveIDs[0] != "CVE-2024-0001" {
		t.Fatalf("p1 %+v", p[1])
	}
	if p[2].Category != model.PatchCatOS || p[2].Severity != model.SevUnspecified {
		t.Fatalf("p2 %+v", p[2])
	}
}

func TestMapMsrcSeverity(t *testing.T) {
	for in, want := range map[string]string{"Critical": model.SevCritical, "Important": model.SevImportant, "Moderate": model.SevModerate, "Low": model.SevLow, "": model.SevUnspecified} {
		if got := MapMsrcSeverity(in); got != want {
			t.Errorf("%q -> %s want %s", in, got, want)
		}
	}
	if ExtractKB("2026-09 Cumulative Update for Windows 11 (KB5031455)") != "KB5031455" {
		t.Error("ExtractKB")
	}
	if MapWUCategory([]string{"Security Updates", "Windows 11"}, "") != model.PatchCatSecurity {
		t.Error("security category")
	}
	if MapWUCategory([]string{"Drivers"}, "Intel - Display") != model.PatchCatDriver {
		t.Error("driver category")
	}
}

func TestParseSoftwareUpdateList(t *testing.T) {
	out := `Software Update Tool

Finding available software
Software Update found the following new or updated software:
* Label: macOS Sonoma 14.4.1-23E224
	Title: macOS Sonoma 14.4.1, Version: 14.4.1, Size: 1024000K, Recommended: YES, Action: restart,
* Label: Safari17.4.1SonomaAuto-17.4.1
	Title: Safari, Version: 17.4.1, Size: 150000K, Recommended: NO,
`
	p := ParseSoftwareUpdateList(out)
	if len(p) != 2 {
		t.Fatalf("got %d: %+v", len(p), p)
	}
	if p[0].PatchID != "macOS Sonoma 14.4.1-23E224" || p[0].Category != model.PatchCatOS || p[0].Severity != model.SevImportant {
		t.Fatalf("p0 %+v", p[0])
	}
	if p[1].Title != "Safari" || p[1].Severity != model.SevUnspecified {
		t.Fatalf("p1 %+v", p[1])
	}
}

func TestParsePackageQueries(t *testing.T) {
	dpkg := "bash\t5.1-6ubuntu1\tUbuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\t1864\tii \trequired\n" +
		"google-chrome-stable\t129.0\tChrome Linux Team <chromium-dev@chromium.org>\t350000\tii \toptional\n" +
		"removed-pkg\t1.0\tX <x@y>\t10\trc \toptional\n"
	s := ParseDpkgQuery(dpkg)
	if len(s) != 2 {
		t.Fatalf("dpkg got %d", len(s))
	}
	if s[0].Publisher != "Canonical" || s[0].Source != "system" || !s[0].Protected {
		t.Fatalf("bash %+v", s[0])
	}
	if s[1].Publisher != "Chrome Linux Team" || s[1].Source != "dpkg" || s[1].SizeMb < 341 {
		t.Fatalf("chrome %+v", s[1])
	}
	rpm := "openssl\t3.0.7-25.el9\tRed Hat, Inc.\t1700000000\t2000000\ngpg-pubkey\tx\t(none)\t0\t0\nzoom\t6.0-1\tZoom Video Communications, Inc.\t1700000000\t300000000\n"
	r := ParseRpmQuery(rpm)
	if len(r) != 2 || r[0].Source != "system" || r[1].Source != "rpm" || r[1].InstallDate == "" {
		t.Fatalf("rpm %+v", r)
	}
}

func TestClassifyDeviceType(t *testing.T) {
	cases := []struct {
		chassis []int
		mfr     string
		model   string
		server  bool
		battery bool
		want    string
	}{
		{[]int{10}, "LENOVO", "20XW", false, true, model.DeviceLaptop},
		{[]int{3}, "Dell Inc.", "OptiPlex 7090", false, false, model.DeviceDesktop},
		{[]int{23}, "Dell Inc.", "PowerEdge R650", true, false, model.DeviceServer},
		{[]int{1}, "VMware, Inc.", "VMware Virtual Platform", false, false, model.DeviceVM},
		{[]int{1}, "Microsoft Corporation", "Virtual Machine", false, false, model.DeviceVM},
		{nil, "Apple Inc.", "MacBookPro18,3", false, true, model.DeviceLaptop},
		{[]int{7}, "Dell Inc.", "Precision 7920 Tower", false, false, model.DeviceWorkstation},
		{nil, "", "", false, false, model.DeviceOther},
	}
	for _, c := range cases {
		if got := ClassifyDeviceType(c.chassis, c.mfr, c.model, c.server, c.battery); got != c.want {
			t.Errorf("%v %s %s: got %s want %s", c.chassis, c.mfr, c.model, got, c.want)
		}
	}
}

func TestMatchProducts(t *testing.T) {
	running := lowerSet([]string{"falcond", "sshd"})
	d := MatchProducts(EDRCatalog, running, func(p string) bool { return p == "/opt/sentinelone" })
	state, prod := StateFromDetections(d)
	if state != model.StateEnabled || prod != "CrowdStrike Falcon" {
		t.Fatalf("got %s %q (%+v)", state, prod, d)
	}
	d = MatchProducts(EDRCatalog, map[string]bool{}, func(p string) bool { return p == "/opt/sentinelone" })
	if state, _ := StateFromDetections(d); state != model.StateDisabled {
		t.Fatalf("installed-not-running should be DISABLED, got %s", state)
	}
	if state, _ := StateFromDetections(nil); state != model.StateNotInstalled {
		t.Fatal("nothing -> NOT_INSTALLED")
	}
}

func TestValidSerial(t *testing.T) {
	for _, s := range []string{"", "To Be Filled By O.E.M.", "0000000", "Default string", "System Serial Number"} {
		if validSerial(s) {
			t.Errorf("%q should be invalid", s)
		}
	}
	if !validSerial("PF3ABCDE") {
		t.Error("real serial rejected")
	}
}
