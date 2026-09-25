package ipc

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/secureendpoint/agent/internal/model"
)

func TestFramingRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	msgs := []*Message{
		{Type: TypeHello, User: `CORP\ekta`},
		{Type: TypePolicy, Workforce: &model.WorkforcePolicy{Enabled: true, IdleThresholdSec: 300}},
		{Type: TypeSegments, Segments: []model.ActivitySegment{{StartedAt: "a", EndedAt: "b", Active: true, App: "Code", InputEvents: 5}}},
		{Type: TypeScreenshot, JPEG: []byte{0xFF, 0xD8, 0x00, '\n', 0xFF}, Blurred: true},
	}
	for _, m := range msgs {
		if err := w.Write(m); err != nil {
			t.Fatal(err)
		}
	}
	r := NewReader(&buf)
	for i, want := range msgs {
		got, err := r.Read()
		if err != nil {
			t.Fatalf("message %d: %v", i, err)
		}
		if got.Type != want.Type {
			t.Errorf("message %d type %q, want %q", i, got.Type, want.Type)
		}
	}
	if got, _ := NewReader(bytes.NewReader(nil)).Read(); got != nil {
		t.Error("empty stream should yield no message")
	}
	if _, err := r.Read(); !errors.Is(err, io.EOF) {
		t.Errorf("want EOF at end, got %v", err)
	}
}

func TestBinaryPayloadSurvivesNewlines(t *testing.T) {
	var buf bytes.Buffer
	img := []byte("line1\nline2\n\x00\xff")
	_ = NewWriter(&buf).Write(&Message{Type: TypeScreenshot, JPEG: img})
	if strings.Count(buf.String(), "\n") != 1 {
		t.Fatal("frame must be exactly one line (base64 JSON)")
	}
	m, err := NewReader(&buf).Read()
	if err != nil || !bytes.Equal(m.JPEG, img) {
		t.Fatalf("payload corrupted: %v", err)
	}
}

func TestTooLargeRejected(t *testing.T) {
	var buf bytes.Buffer
	if err := NewWriter(&buf).Write(&Message{Type: TypeScreenshot, JPEG: make([]byte, MaxMessage)}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	big := strings.Repeat("x", MaxMessage+10) + "\n"
	if _, err := NewReader(strings.NewReader(big)).Read(); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("reader should reject oversized frames, got %v", err)
	}
}
