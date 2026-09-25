// Package ipc is the local channel between the SYSTEM/root agent service and
// the per-user activity helper: newline-delimited JSON over a Windows named
// pipe or a Unix socket. The helper never sees the agent token; the service
// owns the server connection and the offline spool.
package ipc

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"

	"github.com/secureendpoint/agent/internal/model"
)

// Message types.
const (
	TypeHello      = "hello"      // helper -> service: identifies the OS user
	TypePolicy     = "policy"     // service -> helper: current workforce policy (nil = off)
	TypeSegments   = "segments"   // helper -> service: activity batch
	TypeScreenshot = "screenshot" // helper -> service: prepared JPEG
)

// MaxMessage bounds one framed message (base64 screenshot ≤ ~2.7 MB).
const MaxMessage = 4 << 20

// Message is one IPC frame.
type Message struct {
	Type string `json:"type"`

	// hello
	User string `json:"user,omitempty"`

	// policy
	Workforce *model.WorkforcePolicy `json:"workforce,omitempty"`

	// segments
	Segments      []model.ActivitySegment `json:"segments,omitempty"`
	SessionEvents []model.SessionEvent    `json:"sessionEvents,omitempty"`

	// screenshot
	JPEG       []byte `json:"jpeg,omitempty"` // base64 in JSON
	CapturedAt string `json:"capturedAt,omitempty"`
	ActiveApp  string `json:"activeApp,omitempty"`
	Blurred    bool   `json:"blurred,omitempty"`
}

// ErrTooLarge is returned for frames above MaxMessage.
var ErrTooLarge = errors.New("ipc message too large")

// Writer frames messages onto w.
type Writer struct{ w io.Writer }

// NewWriter wraps w.
func NewWriter(w io.Writer) *Writer { return &Writer{w: w} }

// Write sends one message (JSON + '\n').
func (w *Writer) Write(m *Message) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if len(b) > MaxMessage {
		return ErrTooLarge
	}
	_, err = w.w.Write(append(b, '\n'))
	return err
}

// Reader decodes framed messages from r.
type Reader struct{ s *bufio.Scanner }

// NewReader wraps r.
func NewReader(r io.Reader) *Reader {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64<<10), MaxMessage+1)
	return &Reader{s: s}
}

// Read returns the next message; io.EOF when the peer closed.
func (r *Reader) Read() (*Message, error) {
	if !r.s.Scan() {
		if err := r.s.Err(); err != nil {
			if errors.Is(err, bufio.ErrTooLong) {
				return nil, ErrTooLarge
			}
			return nil, err
		}
		return nil, io.EOF
	}
	var m Message
	if err := json.Unmarshal(r.s.Bytes(), &m); err != nil {
		return nil, err
	}
	return &m, nil
}
