// Package usb monitors USB device arrival/removal and enforces the USB
// storage policy (block / read-only / whitelist with temporary approvals).
package usb

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// Device is a USB device as seen by the platform enumerator.
type Device struct {
	Key          string // stable identity while connected
	Class        string // UsbDeviceClass
	VendorID     string // 4 lowercase hex digits
	ProductID    string
	Serial       string
	Label        string
	Manufacturer string
	Instance     string   // platform handle: PnP instance id / sysfs name / bsd disk
	Volumes      []string // mounted volumes (macOS bsd names / Windows drive letters)
	Disabled     bool     // currently disabled/deauthorised
}

// Decision is the policy outcome for a device.
type Decision struct {
	Allowed  bool
	ReadOnly bool
	Enforced bool // policy applies to this device (mass storage + restrictions)
	Reason   string
}

// NormalizeID lowercases, strips 0x and left-pads a VID/PID to 4 hex digits.
func NormalizeID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "0x")
	if i := strings.IndexAny(s, " ("); i > 0 {
		s = s[:i]
	}
	for len(s) < 4 && s != "" {
		s = "0" + s
	}
	return s
}

func expired(e model.UsbWhitelistEntry, now time.Time) bool {
	if e.ExpiresAt == nil || *e.ExpiresAt == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339Nano, *e.ExpiresAt)
	if err != nil {
		return true // unparseable temporary approval: fail closed
	}
	return !now.Before(t)
}

// ActiveWhitelist returns the entries that have not expired.
func ActiveWhitelist(entries []model.UsbWhitelistEntry, now time.Time) []model.UsbWhitelistEntry {
	var out []model.UsbWhitelistEntry
	for _, e := range entries {
		if !expired(e, now) && NormalizeID(e.VendorID) != "" && NormalizeID(e.ProductID) != "" {
			out = append(out, e)
		}
	}
	return out
}

// NextExpiry returns the earliest future expiresAt (zero if none).
func NextExpiry(entries []model.UsbWhitelistEntry, now time.Time) time.Time {
	var next time.Time
	for _, e := range entries {
		if e.ExpiresAt == nil {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, *e.ExpiresAt)
		if err != nil || !t.After(now) {
			continue
		}
		if next.IsZero() || t.Before(next) {
			next = t
		}
	}
	return next
}

// MatchWhitelist finds an active whitelist entry for vid/pid/serial. An entry
// without serial (or "*") matches every serial of that model.
func MatchWhitelist(entries []model.UsbWhitelistEntry, vid, pid, serial string, now time.Time) (model.UsbWhitelistEntry, bool) {
	vid, pid = NormalizeID(vid), NormalizeID(pid)
	for _, e := range ActiveWhitelist(entries, now) {
		if NormalizeID(e.VendorID) != vid || NormalizeID(e.ProductID) != pid {
			continue
		}
		es := strings.TrimSpace(e.SerialNumber)
		if es == "" || es == "*" || strings.EqualFold(es, strings.TrimSpace(serial)) {
			return e, true
		}
	}
	return model.UsbWhitelistEntry{}, false
}

// Evaluate applies the USB policy to a device.
func Evaluate(pol *model.AgentPolicy, d Device, now time.Time) Decision {
	if pol == nil || d.Class != model.UsbClassMassStorage {
		return Decision{Allowed: true}
	}
	u := pol.Usb
	name := pol.Name
	if name == "" {
		name = "device policy"
	}
	if !u.BlockStorage {
		if u.ReadOnly {
			return Decision{Allowed: true, ReadOnly: true, Enforced: true, Reason: fmt.Sprintf("USB storage is read-only by policy %q", name)}
		}
		return Decision{Allowed: true}
	}
	if u.AllowWhitelisted {
		if e, ok := MatchWhitelist(u.Whitelist, d.VendorID, d.ProductID, d.Serial, now); ok {
			reason := fmt.Sprintf("whitelisted by policy %q", name)
			if e.ExpiresAt != nil && *e.ExpiresAt != "" {
				reason = fmt.Sprintf("temporary approval until %s (policy %q)", *e.ExpiresAt, name)
			}
			return Decision{Allowed: true, ReadOnly: e.ReadOnly || u.ReadOnly, Enforced: true, Reason: reason}
		}
	}
	return Decision{Allowed: false, Enforced: true, Reason: fmt.Sprintf("USB mass storage blocked by policy %q", name)}
}

// needsWhitelistMode reports whether blocking must allow some devices
// through (per-device enforcement rather than a blanket driver block).
func needsWhitelistMode(u model.UsbPolicy, now time.Time) bool {
	return u.BlockStorage && u.AllowWhitelisted && len(ActiveWhitelist(u.Whitelist, now)) > 0
}

// udevEscape makes a value safe inside a udev "..." match.
func udevEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.', r == ':':
			b.WriteRune(r)
		default:
			b.WriteRune('?') // udev glob: any single char
		}
	}
	return b.String()
}

// GenerateUdevRules renders /etc/udev/rules.d/99-sem-usb.rules for the policy.
// Returns "" when no restriction applies (the file should be removed).
func GenerateUdevRules(pol *model.AgentPolicy, now time.Time) string {
	if pol == nil || (!pol.Usb.BlockStorage && !pol.Usb.ReadOnly) {
		return ""
	}
	u := pol.Usb
	var b strings.Builder
	b.WriteString("# Managed by SecureEndpoint agent (sem-agent). DO NOT EDIT - regenerated on policy change.\n")
	fmt.Fprintf(&b, "# policy=%q version=%d generated=%s\n", pol.Name, pol.Version, now.UTC().Format(time.RFC3339))
	b.WriteString(`ACTION!="add|change|bind", GOTO="sem_usb_end"` + "\n")
	b.WriteString(`SUBSYSTEM!="usb|block", GOTO="sem_usb_end"` + "\n")

	var allowed []model.UsbWhitelistEntry
	if u.AllowWhitelisted {
		allowed = ActiveWhitelist(u.Whitelist, now)
		sort.SliceStable(allowed, func(i, j int) bool {
			return NormalizeID(allowed[i].VendorID)+NormalizeID(allowed[i].ProductID)+allowed[i].SerialNumber <
				NormalizeID(allowed[j].VendorID)+NormalizeID(allowed[j].ProductID)+allowed[j].SerialNumber
		})
	}
	match := func(e model.UsbWhitelistEntry) string {
		m := fmt.Sprintf(`ATTRS{idVendor}=="%s", ATTRS{idProduct}=="%s"`, udevEscape(NormalizeID(e.VendorID)), udevEscape(NormalizeID(e.ProductID)))
		if s := strings.TrimSpace(e.SerialNumber); s != "" && s != "*" {
			m += fmt.Sprintf(`, ATTRS{serial}=="%s"`, udevEscape(s))
		}
		return m
	}

	// Read-only block devices (whitelisted read-only entries, or global read-only).
	for _, e := range allowed {
		if e.ReadOnly || u.ReadOnly {
			fmt.Fprintf(&b, `SUBSYSTEM=="block", ENV{ID_BUS}=="usb", %s, RUN+="/sbin/blockdev --setro /dev/%%k"`+"\n", match(e))
		}
	}
	if !u.BlockStorage && u.ReadOnly {
		b.WriteString(`SUBSYSTEM=="block", ENV{ID_BUS}=="usb", RUN+="/sbin/blockdev --setro /dev/%k"` + "\n")
	}
	if u.BlockStorage {
		// Whitelisted devices skip the deny rule.
		for _, e := range allowed {
			fmt.Fprintf(&b, `SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_interface", ATTR{bInterfaceClass}=="08", %s, GOTO="sem_usb_end"`+"\n", match(e))
		}
		// Deny every other mass-storage interface.
		b.WriteString(`SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_interface", ATTR{bInterfaceClass}=="08", ATTR{authorized}="0"` + "\n")
	}
	b.WriteString(`LABEL="sem_usb_end"` + "\n")
	return b.String()
}
