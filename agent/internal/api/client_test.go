package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

func newTestClient(t *testing.T, url string) (*Client, *[]time.Duration) {
	t.Helper()
	c, err := New(Options{ServerURL: url, DeviceID: "dev-1", Token: "sem_agt_x", MaxRetries: 4,
		BaseBackoff: 100 * time.Millisecond, MaxBackoff: 1 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	var waits []time.Duration
	c.sleep = func(ctx context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	return c, &waits
}

func TestRetryThenSuccess(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if r.Header.Get("Authorization") != "Bearer sem_agt_x" || r.Header.Get("X-Device-Id") != "dev-1" {
			t.Errorf("missing auth headers")
		}
		if r.URL.Path != "/api/v1/agent/heartbeat" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(model.HeartbeatResponse{PolicyVersion: 4, ServerTime: "2026-09-25T10:00:00.000Z",
			Commands: []model.AgentCommand{{ID: "c1", Type: model.CmdCollectInventory}}})
	}))
	defer srv.Close()
	c, waits := newTestClient(t, srv.URL)
	resp, err := c.Heartbeat(context.Background(), model.HeartbeatRequest{AgentVersion: "1.0.0"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.PolicyVersion != 4 || len(resp.Commands) != 1 {
		t.Fatalf("unexpected response %+v", resp)
	}
	if calls != 3 || len(*waits) != 2 {
		t.Fatalf("calls=%d waits=%v", calls, *waits)
	}
	// Exponential with equal jitter: attempt0 in [50ms,100ms], attempt1 in [100ms,200ms].
	w := *waits
	if w[0] < 50*time.Millisecond || w[0] > 100*time.Millisecond || w[1] < 100*time.Millisecond || w[1] > 200*time.Millisecond {
		t.Fatalf("backoff out of range: %v", w)
	}
}

func TestNoRetryOn4xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"statusCode":400,"message":["events must be an array"]}`))
	}))
	defer srv.Close()
	c, _ := newTestClient(t, srv.URL)
	err := c.UsbEvents(context.Background(), nil)
	if err == nil || !IsPermanent(err) {
		t.Fatalf("expected permanent error, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
	if ae := err.(*APIError); ae.Message != "events must be an array" {
		t.Fatalf("message = %q", ae.Message)
	}
}

func TestGivesUpAfterMaxRetries(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	c, waits := newTestClient(t, srv.URL)
	err := c.SoftwareEvents(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if calls != 5 {
		t.Fatalf("calls = %d, want 5 (1 + 4 retries)", calls)
	}
	for _, w := range *waits {
		if w != time.Second { // Retry-After 7s capped at MaxBackoff 1s
			t.Fatalf("wait = %v, want capped Retry-After", w)
		}
	}
}

func TestBackoffCapped(t *testing.T) {
	c, _ := newTestClient(t, "https://example.invalid")
	for i := 0; i < 40; i++ {
		d := c.backoff(i)
		if d > time.Second || d < 0 {
			t.Fatalf("attempt %d backoff %v exceeds cap", i, d)
		}
	}
}

func TestSpoolWhenOfflineThenFlush(t *testing.T) {
	t.Setenv("SEM_AGENT_DATA_DIR", t.TempDir())
	online := int32(0)
	var received int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&online) == 0 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		atomic.AddInt32(&received, 1)
		_, _ = w.Write([]byte(`{"accepted":1}`))
	}))
	defer srv.Close()
	c, _ := newTestClient(t, srv.URL)
	sp := NewSpool(filepath.Join(t.TempDir(), "spool.jsonl"), 10)
	ev := map[string]any{"events": []model.UsbEvent{{EventType: model.UsbBlocked, DeviceClass: model.UsbClassMassStorage, OccurredAt: model.Now()}}}
	if err := c.Deliver(context.Background(), sp, PathUsbEvents, ev); err != nil {
		t.Fatal(err)
	}
	if err := c.Deliver(context.Background(), sp, CommandResultPath("abc"), model.CommandResult{Status: model.ResultSucceeded}); err != nil {
		t.Fatal(err)
	}
	if sp.Len() != 2 {
		t.Fatalf("spool len = %d, want 2", sp.Len())
	}
	atomic.StoreInt32(&online, 1)
	n, err := sp.Flush(context.Background(), c)
	if err != nil || n != 2 || sp.Len() != 0 || received != 2 {
		t.Fatalf("flush n=%d err=%v len=%d received=%d", n, err, sp.Len(), received)
	}
}
