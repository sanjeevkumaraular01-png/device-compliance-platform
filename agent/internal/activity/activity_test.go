package activity

import (
	"bytes"
	"image"
	"image/color"
	"testing"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

var t0 = time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)

func feed(b *Builder, from time.Time, n int, s Sample) time.Time {
	for i := 0; i < n; i++ {
		s.At = from.Add(time.Duration(i) * time.Second)
		b.Add(s)
	}
	return from.Add(time.Duration(n) * time.Second)
}

func TestBuilderSplitsOnAppChangeAndCountsInput(t *testing.T) {
	b := NewBuilder(5*time.Minute, false)
	next := feed(b, t0, 30, Sample{App: "Code", Input: true})
	feed(b, next, 20, Sample{App: "chrome", Domain: "github.com"})
	segs := b.Flush()
	if len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d", len(segs))
	}
	if segs[0].App != "Code" || segs[0].InputEvents != 30 || !segs[0].Active {
		t.Errorf("first segment wrong: %+v", segs[0])
	}
	if segs[1].Domain != "github.com" || segs[1].InputEvents != 0 {
		t.Errorf("second segment wrong: %+v", segs[1])
	}
	if segs[0].EndedAt != segs[1].StartedAt {
		t.Errorf("segments should be contiguous: %s vs %s", segs[0].EndedAt, segs[1].StartedAt)
	}
}

func TestBuilderMaxSegmentLength(t *testing.T) {
	b := NewBuilder(5*time.Minute, false)
	feed(b, t0, 700, Sample{App: "Code"})
	segs := b.Flush()
	if len(segs) != 3 {
		t.Fatalf("700 s should split into 300+300+100, got %d segments", len(segs))
	}
	for _, s := range segs {
		st, _ := time.Parse(time.RFC3339, s.StartedAt)
		en, _ := time.Parse(time.RFC3339, s.EndedAt)
		if en.Sub(st) > MaxSegment {
			t.Errorf("segment longer than max: %v", en.Sub(st))
		}
	}
}

func TestBuilderIdleDropsAppAndTitle(t *testing.T) {
	b := NewBuilder(2*time.Minute, true)
	next := feed(b, t0, 10, Sample{App: "Code", Title: "secret.txt", Input: true})
	feed(b, next, 10, Sample{App: "Code", Title: "secret.txt", Idle: 3 * time.Minute, Input: true})
	segs := b.Flush()
	if len(segs) != 2 {
		t.Fatalf("want active+idle segments, got %d", len(segs))
	}
	idle := segs[1]
	if idle.Active || idle.App != "" || idle.WindowTitle != "" || idle.InputEvents != 0 {
		t.Errorf("idle segment must carry no app/title/input: %+v", idle)
	}
	if segs[0].WindowTitle != "secret.txt" {
		t.Errorf("titles allowed by policy should be kept for active time")
	}
}

func TestBuilderDropsTitlesUnlessAllowed(t *testing.T) {
	b := NewBuilder(5*time.Minute, false)
	feed(b, t0, 10, Sample{App: "Code", Title: "private doc"})
	if segs := b.Flush(); segs[0].WindowTitle != "" {
		t.Fatal("window title leaked although policy disallows it")
	}
}

func TestBuilderLockedIsIdleAndNoiseDropped(t *testing.T) {
	b := NewBuilder(5*time.Minute, false)
	next := feed(b, t0, 1, Sample{App: "explorer"}) // 1 s alt-tab noise
	feed(b, next, 10, Sample{App: "LockApp", Locked: true, Input: true})
	segs := b.Flush()
	if len(segs) != 1 {
		t.Fatalf("noise < MinSegment must be dropped, got %d segments", len(segs))
	}
	if segs[0].Active || segs[0].InputEvents != 0 {
		t.Errorf("locked time must be idle with no input: %+v", segs[0])
	}
}

func TestBuilderGapStartsNewSegment(t *testing.T) {
	b := NewBuilder(5*time.Minute, false)
	feed(b, t0, 10, Sample{App: "Code"})
	feed(b, t0.Add(time.Hour), 10, Sample{App: "Code"}) // laptop slept
	if segs := b.Flush(); len(segs) != 2 {
		t.Fatalf("a sampling gap must split segments, got %d", len(segs))
	}
}

func pol() *model.WorkforcePolicy {
	return &model.WorkforcePolicy{Enabled: true, Timezone: "Asia/Kolkata", WorkDays: []int{1, 2, 3, 4, 5}, WorkStart: "09:30", WorkEnd: "18:30"}
}

func TestShouldTrack(t *testing.T) {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	thuMorning := time.Date(2026, 9, 24, 10, 0, 0, 0, ist) // Thursday
	thuNight := time.Date(2026, 9, 24, 21, 0, 0, 0, ist)
	saturday := time.Date(2026, 9, 26, 11, 0, 0, 0, ist)

	if !ShouldTrack(pol(), thuMorning) {
		t.Error("work hours on a workday should be tracked")
	}
	if ShouldTrack(pol(), thuNight) || ShouldTrack(pol(), saturday) {
		t.Error("outside hours / weekend must not be tracked")
	}
	p := pol()
	p.TrackOutsideWorkHours = true
	if !ShouldTrack(p, saturday) {
		t.Error("trackOutsideWorkHours should allow weekend tracking")
	}
	p = pol()
	p.ClockedOut = true
	if ShouldTrack(p, thuMorning) {
		t.Error("clocked out users must not be tracked")
	}
	if ShouldTrack(nil, thuMorning) {
		t.Error("nil policy = tracking off")
	}
	// Same instant expressed in UTC must give the same answer.
	if !ShouldTrack(pol(), thuMorning.UTC()) {
		t.Error("timezone conversion wrong")
	}
	night := pol()
	night.WorkStart, night.WorkEnd = "22:00", "06:00"
	if !InWorkHours(night, time.Date(2026, 9, 24, 23, 30, 0, 0, ist)) || InWorkHours(night, time.Date(2026, 9, 24, 12, 0, 0, 0, ist)) {
		t.Error("overnight shift window wrong")
	}
}

func TestSanitizeDomain(t *testing.T) {
	cases := map[string]string{
		"https://www.GitHub.com/org/repo?token=abc#x": "github.com",
		"https://user:pass@mail.google.com:443/inbox": "mail.google.com",
		"docs.example.co.in/private/path":             "docs.example.co.in",
		"http://10.0.0.5:8080/admin":                  "10.0.0.5",
		"chrome://settings":                           "",
		"file:///C:/secret.txt":                       "",
		"not a host":                                  "",
		"":                                            "",
		"intranet":                                    "",
		"localhost":                                   "localhost",
	}
	for in, want := range cases {
		if got := SanitizeDomain(in); got != want {
			t.Errorf("SanitizeDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBoxBlurChangesPixelsKeepsSize(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 64, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 64; x++ {
			if (x/4+y/4)%2 == 0 { // checkerboard = sharp "text"
				img.Set(x, y, color.White)
			} else {
				img.Set(x, y, color.Black)
			}
		}
	}
	orig := append([]uint8(nil), img.Pix...)
	BoxBlur(img, 6)
	if img.Bounds().Dx() != 64 || img.Bounds().Dy() != 32 {
		t.Fatal("blur must keep dimensions")
	}
	if bytes.Equal(orig, img.Pix) {
		t.Fatal("blur did not change the image")
	}
	// A heavy blur of a fine checkerboard converges to mid-grey.
	r, _, _, _ := img.At(32, 16).RGBA()
	if r>>8 < 80 || r>>8 > 175 {
		t.Errorf("expected mid-grey after blur, got %d", r>>8)
	}
}

func TestPrepareScreenshotDownscalesAndEncodes(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 3200, 1800))
	jpg, w, h, err := PrepareScreenshot(img, true)
	if err != nil {
		t.Fatal(err)
	}
	if w != MaxScreenshotWidth || h != 900 {
		t.Errorf("want 1600x900, got %dx%d", w, h)
	}
	if len(jpg) < 3 || jpg[0] != 0xFF || jpg[1] != 0xD8 {
		t.Error("output is not a JPEG")
	}
}

func TestNativeMessageRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteNativeMessage(&buf, TabMessage{Host: "github.com", Browser: "chrome"}); err != nil {
		t.Fatal(err)
	}
	if buf.Bytes()[0] == 0 || buf.Bytes()[1] != 0 {
		t.Error("length prefix must be little-endian")
	}
	var m TabMessage
	if err := ReadNativeMessage(&buf, &m); err != nil || m.Host != "github.com" {
		t.Fatalf("round trip failed: %+v %v", m, err)
	}
	bad := bytes.NewReader([]byte{0xff, 0xff, 0xff, 0x7f})
	if err := ReadNativeMessage(bad, &m); err == nil {
		t.Error("oversized frame must be rejected")
	}
}

func TestNativeHostManifest(t *testing.T) {
	b, err := NativeHostManifestJSON(`C:\Program Files\SecureEndpoint\sem-agent.exe`, []string{"abcdefghijklmnopabcdefghijklmnop", " "})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`chrome-extension://abcdefghijklmnopabcdefghijklmnop/`)) || bytes.Contains(b, []byte(`chrome-extension:// /`)) {
		t.Errorf("unexpected manifest: %s", b)
	}
	if !IsNativeHostInvocation([]string{"chrome-extension://abc/"}) || IsNativeHostInvocation([]string{"run"}) {
		t.Error("native host invocation detection wrong")
	}
}

func TestInputTracker(t *testing.T) {
	var tr inputTracker
	in, _ := tr.observe(100, 0)
	if in {
		t.Error("first observation has no baseline")
	}
	if in, _ = tr.observe(100, time.Second); in {
		t.Error("unchanged last-input marker means no input")
	}
	if in, _ = tr.observe(250, 0); !in {
		t.Error("changed marker means input happened")
	}
}

func TestNormalizeApp(t *testing.T) {
	for in, want := range map[string]string{
		`C:\Program Files\Google\Chrome\Application\chrome.exe`: "chrome",
		"/usr/bin/code": "code",
		"Safari":        "Safari",
	} {
		if got := normalizeApp(in); got != want {
			t.Errorf("normalizeApp(%q) = %q, want %q", in, got, want)
		}
	}
	if !IsBrowser("msedge") || IsBrowser("Code") {
		t.Error("IsBrowser wrong")
	}
}
