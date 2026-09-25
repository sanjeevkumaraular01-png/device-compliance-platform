package collector

// Pure parsers for command output. They live in an untagged file so they are
// unit-tested on every platform.

import (
	"bufio"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// ParseOSRelease parses /etc/os-release KEY="value" lines.
func ParseOSRelease(text string) map[string]string {
	m := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if uq, err := strconv.Unquote(v); err == nil {
			v = uq
		} else {
			v = strings.Trim(v, `"'`)
		}
		m[strings.TrimSpace(k)] = v
	}
	return m
}

// --- lsblk -------------------------------------------------------------------

type lsblkNode struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	FsType      *string     `json:"fstype"`
	MountPoint  *string     `json:"mountpoint"`
	MountPoints []*string   `json:"mountpoints"`
	Children    []lsblkNode `json:"children"`
}

func (n lsblkNode) mounts() []string {
	var out []string
	if n.MountPoint != nil {
		out = append(out, *n.MountPoint)
	}
	for _, m := range n.MountPoints {
		if m != nil {
			out = append(out, *m)
		}
	}
	return out
}

// ParseLsblkRootEncryption inspects `lsblk -J -o NAME,TYPE,FSTYPE,MOUNTPOINT`
// output and reports whether the root filesystem sits on a dm-crypt (LUKS)
// device. Returns (ENABLED|DISABLED|UNKNOWN, method).
func ParseLsblkRootEncryption(data []byte) (string, string) {
	var doc struct {
		Blockdevices []lsblkNode `json:"blockdevices"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return model.StateUnknown, ""
	}
	state, method := model.StateUnknown, ""
	var walk func(n lsblkNode, crypt bool, luks bool)
	walk = func(n lsblkNode, crypt bool, luks bool) {
		if n.Type == "crypt" {
			crypt = true
		}
		if n.FsType != nil && *n.FsType == "crypto_LUKS" {
			luks = true
		}
		for _, m := range n.mounts() {
			if m == "/" {
				if crypt {
					state = model.StateEnabled
					method = "dm-crypt"
					if luks {
						method = "LUKS"
					}
				} else if state != model.StateEnabled {
					state = model.StateDisabled
				}
			}
		}
		for _, c := range n.Children {
			walk(c, crypt, luks)
		}
	}
	for _, n := range doc.Blockdevices {
		walk(n, false, false)
	}
	return state, method
}

// --- APT -----------------------------------------------------------------------

// `apt list --upgradable` line: name/suite1,suite2 newver arch [upgradable from: oldver]
var aptLineRE = regexp.MustCompile(`^([^/\s]+)/(\S+)\s+(\S+)\s+(\S+)(?:\s+\[upgradable from:\s*([^\]]+)\])?`)

// AptPatchID builds a stable patch id for a Debian package update.
func AptPatchID(pkg, version string) string { return "apt:" + pkg + ":" + version }

// ParseAptPatchID reverses AptPatchID.
func ParseAptPatchID(id string) (pkg, version string, ok bool) {
	if !strings.HasPrefix(id, "apt:") {
		return "", "", false
	}
	rest := strings.TrimPrefix(id, "apt:")
	pkg, version, ok = strings.Cut(rest, ":")
	return pkg, version, ok && pkg != ""
}

// ParseAptUpgradable converts `apt list --upgradable` output into MISSING
// patches. Packages from a "-security" pocket are SECURITY/IMPORTANT.
func ParseAptUpgradable(text string) []model.Patch {
	var out []model.Patch
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		m := aptLineRE.FindStringSubmatch(strings.TrimSpace(sc.Text()))
		if m == nil {
			continue
		}
		pkg, suites, ver := m[1], m[2], m[3]
		p := model.Patch{
			PatchID:  AptPatchID(pkg, ver),
			Title:    pkg + " " + ver,
			Category: model.PatchCatOS,
			Severity: model.SevUnspecified,
			State:    model.PatchMissing,
			Product:  pkg,
		}
		if m[5] != "" {
			p.Title = pkg + " " + strings.TrimSpace(m[5]) + " → " + ver
		}
		if strings.Contains(suites, "-security") {
			p.Category = model.PatchCatSecurity
			p.Severity = model.SevImportant
		}
		out = append(out, p)
	}
	return out
}

// --- DNF / YUM ------------------------------------------------------------------

var dnfSevRE = regexp.MustCompile(`(?i)^(critical|important|moderate|low)/sec\.?$`)

// ParseDnfUpdateinfo parses `dnf -q updateinfo list --updates` output (one
// "ADVISORY TYPE PACKAGE" row per package) plus optional `--with-cve` output
// ("CVE-ID TYPE PACKAGE") and returns one MISSING patch per advisory.
func ParseDnfUpdateinfo(list, cveList string) []model.Patch {
	type adv struct {
		p    model.Patch
		pkgs []string
	}
	advisories := map[string]*adv{}
	var order []string
	pkgAdv := map[string][]string{}
	sc := bufio.NewScanner(strings.NewReader(list))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 || strings.HasPrefix(f[0], "Last") {
			continue
		}
		id, typ, pkg := f[0], f[1], f[2]
		a, ok := advisories[id]
		if !ok {
			cat, sev := dnfTypeToCategory(typ)
			a = &adv{p: model.Patch{PatchID: id, Category: cat, Severity: sev, State: model.PatchMissing}}
			advisories[id] = a
			order = append(order, id)
		}
		a.pkgs = append(a.pkgs, pkg)
		pkgAdv[pkg] = append(pkgAdv[pkg], id)
	}
	sc = bufio.NewScanner(strings.NewReader(cveList))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 || !strings.HasPrefix(strings.ToUpper(f[0]), "CVE-") {
			continue
		}
		for _, id := range pkgAdv[f[2]] {
			a := advisories[id]
			if !containsStr(a.p.CveIDs, f[0]) {
				a.p.CveIDs = append(a.p.CveIDs, f[0])
			}
		}
	}
	out := make([]model.Patch, 0, len(order))
	for _, id := range order {
		a := advisories[id]
		sort.Strings(a.pkgs)
		title := id + ": " + strings.Join(a.pkgs, ", ")
		if len(title) > 250 {
			title = title[:247] + "..."
		}
		a.p.Title = title
		if len(a.pkgs) > 0 {
			a.p.Product = a.pkgs[0]
		}
		out = append(out, a.p)
	}
	return out
}

func dnfTypeToCategory(typ string) (string, string) {
	if m := dnfSevRE.FindStringSubmatch(typ); m != nil {
		return model.PatchCatSecurity, MapMsrcSeverity(m[1])
	}
	switch strings.ToLower(typ) {
	case "security", "sec.":
		return model.PatchCatSecurity, model.SevUnspecified
	case "enhancement", "newpackage":
		return model.PatchCatFeature, model.SevUnspecified
	default: // bugfix, unspecified
		return model.PatchCatOS, model.SevUnspecified
	}
}

// --- Windows Update --------------------------------------------------------------

// MapMsrcSeverity maps MSRC / vendor severities to PatchSeverity.
func MapMsrcSeverity(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "critical":
		return model.SevCritical
	case "important", "high":
		return model.SevImportant
	case "moderate", "medium":
		return model.SevModerate
	case "low":
		return model.SevLow
	default:
		return model.SevUnspecified
	}
}

// MapWUCategory maps Windows Update category names to PatchCategory.
func MapWUCategory(categories []string, title string) string {
	joined := strings.ToLower(strings.Join(categories, "|") + "|" + title)
	switch {
	case strings.Contains(joined, "driver"):
		return model.PatchCatDriver
	case strings.Contains(joined, "security"), strings.Contains(joined, "critical updates"), strings.Contains(joined, "definition"):
		return model.PatchCatSecurity
	case strings.Contains(joined, "feature pack"), strings.Contains(joined, "upgrades"), strings.Contains(joined, "feature update"):
		return model.PatchCatFeature
	case strings.Contains(joined, "microsoft 365"), strings.Contains(joined, "office"), strings.Contains(joined, "visual studio"),
		strings.Contains(joined, "sql server"), strings.Contains(joined, "edge"), strings.Contains(joined, ".net"):
		return model.PatchCatApplication
	default:
		return model.PatchCatOS
	}
}

var kbRE = regexp.MustCompile(`(?i)\bKB(\d{6,8})\b`)

// ExtractKB returns "KBnnnnnnn" from a title, or "".
func ExtractKB(title string) string {
	if m := kbRE.FindStringSubmatch(title); m != nil {
		return "KB" + m[1]
	}
	return ""
}

// ParseQFEDate parses Win32_QuickFixEngineering.InstalledOn (locale dependent
// M/D/YYYY, or hex FILETIME on some systems).
func ParseQFEDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	for _, layout := range []string{"1/2/2006", "01/02/2006", "2006-01-02", "2/1/2006", "20060102"} {
		if t, err := time.Parse(layout, s); err == nil {
			return model.FormatTime(t)
		}
	}
	if v, err := strconv.ParseInt(strings.TrimPrefix(s, "0x"), 16, 64); err == nil && len(s) >= 15 {
		// FILETIME: 100ns since 1601-01-01
		t := time.Unix((v-116444736000000000)/10000000, 0)
		if t.Year() > 1990 && t.Year() < 2200 {
			return model.FormatTime(t)
		}
	}
	return ""
}

// --- macOS softwareupdate ------------------------------------------------------

var (
	suLabelRE = regexp.MustCompile(`^\*\s*Label:\s*(.+)$`)
	suTitleRE = regexp.MustCompile(`^\s*Title:\s*([^,]+)(.*)$`)
	// Legacy (< 10.15) format: "   * macOS Update-1.2.3" followed by "\tmacOS Update (1.2.3), 1234K [recommended] [restart]"
	suLegacyRE = regexp.MustCompile(`^\s*\*\s+(\S.*)$`)
)

// ParseSoftwareUpdateList parses `softwareupdate --list` output.
func ParseSoftwareUpdateList(text string) []model.Patch {
	var out []model.Patch
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r")
		var label string
		if m := suLabelRE.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			label = strings.TrimSpace(m[1])
		} else if m := suLegacyRE.FindStringSubmatch(line); m != nil && !strings.Contains(line, "Label:") {
			label = strings.TrimSpace(m[1])
		} else {
			continue
		}
		p := model.Patch{PatchID: label, Title: label, State: model.PatchMissing, Severity: model.SevUnspecified, Category: model.PatchCatApplication}
		if i+1 < len(lines) {
			next := strings.TrimSpace(lines[i+1])
			rest := next
			if m := suTitleRE.FindStringSubmatch(next); m != nil {
				p.Title = strings.TrimSpace(m[1])
				rest = m[2]
			}
			if strings.Contains(strings.ToLower(rest), "recommended: yes") || strings.Contains(strings.ToLower(rest), "[recommended]") {
				p.Severity = model.SevImportant
			}
			i++
		}
		lt := strings.ToLower(p.Title + " " + label)
		switch {
		case strings.Contains(lt, "security") || strings.Contains(lt, "xprotect") || strings.Contains(lt, "rapid security") || strings.Contains(lt, "mrt"):
			p.Category = model.PatchCatSecurity
			if p.Severity == model.SevUnspecified {
				p.Severity = model.SevImportant
			}
		case strings.Contains(lt, "macos") || strings.Contains(lt, "os x"):
			p.Category = model.PatchCatOS
			if strings.Contains(lt, "upgrade") {
				p.Category = model.PatchCatFeature
			}
		}
		p.Product = "macOS"
		out = append(out, p)
	}
	return out
}

// --- Linux package inventories -------------------------------------------------

var emailRE = regexp.MustCompile(`\s*<[^>]*>`)

// ParseDpkgQuery parses
// dpkg-query -W -f='${Package}\t${Version}\t${Maintainer}\t${Installed-Size}\t${db:Status-Abbrev}\t${Priority}\n'.
func ParseDpkgQuery(text string) []model.Software {
	var out []model.Software
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 4<<20)
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		if len(f) < 5 {
			continue
		}
		if !strings.HasPrefix(strings.TrimSpace(f[4]), "ii") {
			continue
		}
		s := model.Software{Name: f[0], Version: f[1], Source: "dpkg", PackageID: f[0]}
		maint := f[2]
		lm := strings.ToLower(maint)
		switch {
		case strings.Contains(lm, "ubuntu.com") || strings.Contains(lm, "canonical"):
			s.Publisher, s.Source = "Canonical", "system"
		case strings.Contains(lm, "debian.org"):
			s.Publisher = "Debian"
		default:
			s.Publisher = strings.TrimSpace(emailRE.ReplaceAllString(maint, ""))
		}
		if kb, err := strconv.ParseFloat(strings.TrimSpace(f[3]), 64); err == nil && kb > 0 {
			s.SizeMb = round2(kb / 1024)
		}
		if len(f) > 5 {
			switch strings.TrimSpace(f[5]) {
			case "required", "important":
				s.Protected = true
			}
		}
		out = append(out, s)
	}
	return out
}

// ParseRpmQuery parses
// rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME}\t%{SIZE}\n'.
func ParseRpmQuery(text string) []model.Software {
	var out []model.Software
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 4<<20)
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		if len(f) < 5 || f[0] == "gpg-pubkey" {
			continue
		}
		s := model.Software{Name: f[0], Version: f[1], Source: "rpm", PackageID: f[0]}
		if v := strings.TrimSpace(f[2]); v != "(none)" {
			s.Publisher = v
		}
		lv := strings.ToLower(s.Publisher)
		for _, osv := range []string{"red hat", "fedora project", "centos", "rocky enterprise", "almalinux", "suse", "oracle america", "amazon"} {
			if strings.Contains(lv, osv) {
				s.Source = "system"
				break
			}
		}
		if ts, err := strconv.ParseInt(strings.TrimSpace(f[3]), 10, 64); err == nil && ts > 0 {
			s.InstallDate = model.FormatTime(time.Unix(ts, 0))
		}
		if b, err := strconv.ParseFloat(strings.TrimSpace(f[4]), 64); err == nil && b > 0 {
			s.SizeMb = round2(b / 1024 / 1024)
		}
		out = append(out, s)
	}
	return out
}

func round2(f float64) float64 { return float64(int64(f*100+0.5)) / 100 }

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// protectedPackages are never uninstalled by the agent (Linux).
var protectedPackages = []string{
	"linux-image", "linux-generic", "kernel", "systemd", "libc6", "glibc", "bash", "coreutils", "dpkg", "apt",
	"rpm", "dnf", "yum", "sudo", "openssh-server", "openssh", "grub", "shim", "init", "base-files", "util-linux",
	"sem-agent", "secureendpoint",
}

// IsProtectedPackage reports OS-critical packages.
func IsProtectedPackage(name string) bool {
	n := strings.ToLower(name)
	for _, p := range protectedPackages {
		if n == p || strings.HasPrefix(n, p+"-") || strings.HasPrefix(n, p) && (p == "linux-image" || p == "kernel") {
			return true
		}
	}
	return strings.Contains(n, "secureendpoint")
}
