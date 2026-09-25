package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

// Spool is a persistent FIFO of requests that could not be delivered because
// the server was unreachable. It is stored as JSON lines.
type Spool struct {
	path       string
	maxEntries int
	mu         sync.Mutex
}

type spoolEntry struct {
	Path     string          `json:"path"`
	Body     json.RawMessage `json:"body"`
	QueuedAt time.Time       `json:"queuedAt"`
}

// NewSpool returns a spool stored at path, keeping at most maxEntries
// (oldest dropped first).
func NewSpool(path string, maxEntries int) *Spool {
	if maxEntries <= 0 {
		maxEntries = 5000
	}
	return &Spool{path: path, maxEntries: maxEntries}
}

// Add appends a request.
func (s *Spool) Add(path string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, _ := s.readLocked()
	entries = append(entries, spoolEntry{Path: path, Body: raw, QueuedAt: time.Now().UTC()})
	if len(entries) > s.maxEntries {
		entries = entries[len(entries)-s.maxEntries:]
	}
	return s.writeLocked(entries)
}

// Len returns the number of queued requests.
func (s *Spool) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, _ := s.readLocked()
	return len(e)
}

// Flush delivers queued requests in order via c. Delivery stops at the first
// transient failure; permanently rejected entries (4xx) are dropped.
// It returns the number of entries delivered.
func (s *Spool) Flush(ctx context.Context, c *Client) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readLocked()
	if err != nil || len(entries) == 0 {
		return 0, err
	}
	sent := 0
	i := 0
	var ferr error
	for ; i < len(entries); i++ {
		e := entries[i]
		err := c.do(ctx, http.MethodPost, e.Path, e.Body, nil, true, 0)
		if err == nil {
			sent++
			continue
		}
		if IsPermanent(err) {
			c.log.Warn("dropping spooled request rejected by server", "path", e.Path, "err", err.Error())
			continue
		}
		ferr = err
		break
	}
	if werr := s.writeLocked(entries[i:]); werr != nil && ferr == nil {
		ferr = werr
	}
	return sent, ferr
}

func (s *Spool) readLocked() ([]spoolEntry, error) {
	f, err := os.Open(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []spoolEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 16<<20)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var e spoolEntry
		if json.Unmarshal(line, &e) == nil && e.Path != "" {
			out = append(out, e)
		}
	}
	return out, sc.Err()
}

func (s *Spool) writeLocked(entries []spoolEntry) error {
	if len(entries) == 0 {
		err := os.Remove(s.path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var buf bytes.Buffer
	for _, e := range entries {
		b, err := json.Marshal(e)
		if err != nil {
			continue
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	return platform.WriteFileSecure(s.path, buf.Bytes())
}

// Deliver posts body to path; when the server is unreachable (or returns a
// transient error) the request is spooled for later delivery. Permanent
// rejections are returned without spooling.
func (c *Client) Deliver(ctx context.Context, sp *Spool, path string, body any) error {
	err := c.Do(ctx, http.MethodPost, path, body, nil)
	if err == nil || IsPermanent(err) || sp == nil {
		return err
	}
	if serr := sp.Add(path, body); serr != nil {
		return errors.Join(err, serr)
	}
	c.log.Info("server unreachable, request spooled", "path", path, "err", err.Error())
	return nil
}
