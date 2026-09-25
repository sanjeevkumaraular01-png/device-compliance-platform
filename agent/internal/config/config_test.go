package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/secureendpoint/agent/internal/model"
)

func TestRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.json")
	in := &Config{
		ServerURL:          "https://sem.example.com",
		DeviceID:           "3f0c7a1e-0000-4000-8000-000000000001",
		AgentToken:         "sem_agt_secret_value",
		Status:             "ACTIVE",
		CertFile:           filepath.Join(dir, "device.crt"),
		KeyFile:            filepath.Join(dir, "device.key"),
		CheckinIntervalSec: 300,
		Policy: &model.AgentPolicy{PolicyID: "p1", Version: 7, Name: "Default",
			Usb: model.UsbPolicy{BlockStorage: true, Whitelist: []model.UsbWhitelistEntry{{VendorID: "0781", ProductID: "5567"}}}},
	}
	if err := in.Save(path); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		st, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %v, want 0600", st.Mode().Perm())
		}
	}
	raw, _ := os.ReadFile(path)
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatal(err)
	}
	if _, ok := generic["agentToken"]; !ok {
		t.Fatal("agentToken not persisted")
	}
	if runtime.GOOS == "windows" && strings.Contains(string(raw), "sem_agt_secret_value") {
		t.Fatal("token stored in clear text on Windows")
	}

	out, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if out.AgentToken != in.AgentToken || out.DeviceID != in.DeviceID || out.ServerURL != in.ServerURL {
		t.Fatalf("round trip mismatch: %+v", out)
	}
	if out.Policy == nil || out.Policy.Version != 7 || len(out.Policy.Usb.Whitelist) != 1 {
		t.Fatalf("policy lost: %+v", out.Policy)
	}
	if !out.Enrolled() {
		t.Fatal("expected enrolled")
	}
}

func TestLoadMissing(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "nope.json"))
	if err != ErrNotEnrolled {
		t.Fatalf("err = %v, want ErrNotEnrolled", err)
	}
}

func TestNormalizeServerURL(t *testing.T) {
	cases := map[string]string{
		"https://sem.example.com/":        "https://sem.example.com",
		"https://sem.example.com/api/v1":  "https://sem.example.com",
		"https://sem.example.com/api/v1/": "https://sem.example.com",
		" https://h:8443 ":                "https://h:8443",
	}
	for in, want := range cases {
		if got := NormalizeServerURL(in); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}
