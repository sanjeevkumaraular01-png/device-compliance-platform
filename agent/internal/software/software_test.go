package software

import (
	"path/filepath"
	"testing"

	"github.com/secureendpoint/agent/internal/model"
)

func strp(s string) *string { return &s }

func TestMatcher(t *testing.T) {
	m := NewMatcher([]model.BlacklistEntry{
		{Name: "uTorrent", MatchType: model.MatchExact},
		{Name: "teamviewer", MatchType: model.MatchContains},
		{Name: `^Wireshark\s+\d`, MatchType: model.MatchRegex},
		{Name: "Player", Publisher: strp("Shady Corp"), MatchType: model.MatchContains},
		{Name: "([bad", MatchType: model.MatchRegex}, // invalid regex is ignored
	})
	cases := []struct {
		name, pub string
		want      bool
	}{
		{"utorrent", "", true},      // EXACT is case-insensitive
		{"uTorrent Web", "", false}, // EXACT requires full name
		{"TeamViewer 15", "TeamViewer", true},
		{"WIRESHARK 4.2.3 x64", "", true}, // REGEX case-insensitive
		{"Wireshark Portable", "", false},
		{"Media Player", "Shady Corp Ltd", true},
		{"Media Player", "Microsoft", false}, // publisher constraint
		{"Notepad++", "Notepad++ Team", false},
	}
	for _, c := range cases {
		_, got := m.Match(c.name, c.pub)
		if got != c.want {
			t.Errorf("Match(%q,%q)=%v want %v", c.name, c.pub, got, c.want)
		}
	}
}

func TestDiff(t *testing.T) {
	prev := []model.Software{
		{Name: "Google Chrome", Version: "128.0"},
		{Name: "7-Zip", Version: "23.01"},
		{Name: "Zoom", Version: "6.0"},
		{Name: "Python", Version: "3.11"},
		{Name: "Python", Version: "3.12"},
	}
	cur := []model.Software{
		{Name: "google chrome", Version: "129.0"}, // upgrade -> INSTALLED only
		{Name: "7-Zip", Version: "23.01"},         // unchanged
		{Name: "Slack", Version: "4.40"},          // new
		{Name: "Python", Version: "3.12"},         // 3.11 removed side-by-side
	}
	ev := Diff(prev, cur, "2026-09-25T10:00:00.000Z", "alice")
	got := map[string]string{}
	for _, e := range ev {
		got[e.Action+":"+e.Name+":"+e.Version] = e.UserName
	}
	want := []string{
		"INSTALLED:google chrome:129.0",
		"INSTALLED:Slack:4.40",
		"REMOVED:Zoom:6.0",
		"REMOVED:Python:3.11",
	}
	if len(ev) != len(want) {
		t.Fatalf("got %d events: %+v", len(ev), ev)
	}
	for _, w := range want {
		if _, ok := got[w]; !ok {
			t.Errorf("missing event %s; got %v", w, got)
		}
	}
	if len(Diff(cur, cur, "", "")) != 0 {
		t.Error("identical inventories must produce no events")
	}
}

func TestSnapshotRoundTrip(t *testing.T) {
	s := NewSnapshot(filepath.Join(t.TempDir(), "snap.json"))
	if _, ok := s.Load(); ok {
		t.Fatal("expected no snapshot")
	}
	in := []model.Software{{Name: "A", Version: "1", Publisher: "P"}}
	if err := s.Save(in); err != nil {
		t.Fatal(err)
	}
	out, ok := s.Load()
	if !ok || len(out) != 1 || out[0].Name != "A" || out[0].Publisher != "P" {
		t.Fatalf("got %+v", out)
	}
}

func TestFind(t *testing.T) {
	items := []model.Software{{Name: "VLC media player", Version: "3.0.20"}}
	if _, ok := Find(items, "vlc media player", ""); !ok {
		t.Error("case-insensitive find failed")
	}
	if _, ok := Find(items, "VLC media player", "2.0"); ok {
		t.Error("version mismatch must not match")
	}
}
