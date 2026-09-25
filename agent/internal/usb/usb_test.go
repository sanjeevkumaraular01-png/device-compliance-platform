package usb

import (
	"strings"
	"testing"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

func sp(s string) *string { return &s }

var now = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)

func policy() *model.AgentPolicy {
	return &model.AgentPolicy{Name: "Corp", Version: 3, Usb: model.UsbPolicy{
		BlockStorage: true, AllowWhitelisted: true,
		Whitelist: []model.UsbWhitelistEntry{
			{VendorID: "0781", ProductID: "5567", SerialNumber: "4C530001"},                                         // permanent, exact serial
			{VendorID: "0x0951", ProductID: "1666", SerialNumber: "", ReadOnly: true},                               // any serial, read-only
			{VendorID: "abcd", ProductID: "1234", SerialNumber: "TEMP1", ExpiresAt: sp("2026-09-25T12:00:00.000Z")}, // temporary, active
			{VendorID: "abcd", ProductID: "9999", SerialNumber: "OLD", ExpiresAt: sp("2026-09-25T09:59:59.000Z")},   // expired
		},
	}}
}

func TestNormalizeID(t *testing.T) {
	for in, want := range map[string]string{"0x0781": "0781", "781": "0781", "ABCD": "abcd", "0x05ac  (Apple Inc.)": "05ac"} {
		if got := NormalizeID(in); got != want {
			t.Errorf("%q -> %q want %q", in, got, want)
		}
	}
}

func TestMatchWhitelist(t *testing.T) {
	wl := policy().Usb.Whitelist
	cases := []struct {
		vid, pid, serial string
		want             bool
	}{
		{"0781", "5567", "4c530001", true}, // serial compare is case-insensitive
		{"0781", "5567", "OTHER", false},   // serial mismatch
		{"0951", "1666", "anything", true}, // wildcard serial
		{"ABCD", "1234", "TEMP1", true},    // temporary approval still valid
		{"abcd", "9999", "OLD", false},     // expired approval
		{"1234", "5678", "", false},
	}
	for _, c := range cases {
		_, ok := MatchWhitelist(wl, c.vid, c.pid, c.serial, now)
		if ok != c.want {
			t.Errorf("%s:%s:%s = %v want %v", c.vid, c.pid, c.serial, ok, c.want)
		}
	}
	// After expiry the temporary entry no longer matches.
	if _, ok := MatchWhitelist(wl, "abcd", "1234", "TEMP1", now.Add(3*time.Hour)); ok {
		t.Error("temporary approval should expire")
	}
	if got := NextExpiry(wl, now); !got.Equal(time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)) {
		t.Errorf("NextExpiry = %v", got)
	}
}

func TestEvaluate(t *testing.T) {
	p := policy()
	storage := func(vid, pid, serial string) Device {
		return Device{Class: model.UsbClassMassStorage, VendorID: vid, ProductID: pid, Serial: serial}
	}
	if d := Evaluate(p, storage("0781", "5567", "4C530001"), now); !d.Allowed || d.ReadOnly {
		t.Errorf("whitelisted: %+v", d)
	}
	if d := Evaluate(p, storage("0951", "1666", "x"), now); !d.Allowed || !d.ReadOnly {
		t.Errorf("read-only whitelisted: %+v", d)
	}
	if d := Evaluate(p, storage("1111", "2222", "x"), now); d.Allowed || !d.Enforced || !strings.Contains(d.Reason, "blocked") {
		t.Errorf("unknown storage must be blocked: %+v", d)
	}
	if d := Evaluate(p, Device{Class: model.UsbClassHID, VendorID: "046d", ProductID: "c52b"}, now); !d.Allowed || d.Enforced {
		t.Errorf("HID must not be affected: %+v", d)
	}
	p.Usb.AllowWhitelisted = false
	if d := Evaluate(p, storage("0781", "5567", "4C530001"), now); d.Allowed {
		t.Errorf("allowWhitelisted=false must block all storage: %+v", d)
	}
	p.Usb.BlockStorage, p.Usb.ReadOnly = false, true
	if d := Evaluate(p, storage("1111", "2222", ""), now); !d.Allowed || !d.ReadOnly {
		t.Errorf("global read-only: %+v", d)
	}
	if d := Evaluate(nil, storage("1111", "2222", ""), now); !d.Allowed {
		t.Error("nil policy must allow")
	}
}

func TestGenerateUdevRules(t *testing.T) {
	rules := GenerateUdevRules(policy(), now)
	mustContain := []string{
		`ATTR{bInterfaceClass}=="08", ATTRS{idVendor}=="0781", ATTRS{idProduct}=="5567", ATTRS{serial}=="4C530001", GOTO="sem_usb_end"`,
		`ATTRS{idVendor}=="0951", ATTRS{idProduct}=="1666", GOTO="sem_usb_end"`,
		`ATTRS{idVendor}=="abcd", ATTRS{idProduct}=="1234", ATTRS{serial}=="TEMP1"`,
		`ENV{DEVTYPE}=="usb_interface", ATTR{bInterfaceClass}=="08", ATTR{authorized}="0"`,
		`RUN+="/sbin/blockdev --setro /dev/%k"`,
		`LABEL="sem_usb_end"`,
	}
	for _, s := range mustContain {
		if !strings.Contains(rules, s) {
			t.Errorf("rules missing %q\n%s", s, rules)
		}
	}
	if strings.Contains(rules, "9999") {
		t.Error("expired entry must not be rendered")
	}
	// The deny rule must come after all allow rules.
	if strings.LastIndex(rules, `GOTO="sem_usb_end"`+"\n") > strings.Index(rules, `ATTR{authorized}="0"`) {
		t.Error("deny rule must follow whitelist rules")
	}
	// Injection attempt in serial is neutralised.
	p := policy()
	p.Usb.Whitelist = []model.UsbWhitelistEntry{{VendorID: "0781", ProductID: "5567", SerialNumber: `x", RUN+="/bin/sh`}}
	if r := GenerateUdevRules(p, now); strings.Contains(r, `/bin/sh`) && strings.Contains(r, `RUN+="/bin/sh`) {
		t.Errorf("serial not escaped:\n%s", r)
	}
	// No restrictions -> no file.
	p.Usb.BlockStorage, p.Usb.ReadOnly = false, false
	if GenerateUdevRules(p, now) != "" {
		t.Error("expected empty rules when USB is unrestricted")
	}
}
