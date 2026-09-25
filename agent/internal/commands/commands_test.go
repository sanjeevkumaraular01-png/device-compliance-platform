package commands

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

func newTestDispatcher(t *testing.T) (*Dispatcher, *int) {
	d := NewDispatcher(nil, filepath.Join(t.TempDir(), "seen.json"))
	d.now = func() time.Time { return time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC) }
	calls := 0
	d.Register(model.CmdCollectInventory, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		calls++
		return model.CommandResult{Status: model.ResultSucceeded, Output: "ok"}
	})
	return d, &calls
}

func TestRejectsUnknownType(t *testing.T) {
	d, _ := newTestDispatcher(t)
	res, executed := d.Execute(context.Background(), model.AgentCommand{ID: "1", Type: "RUN_SHELL", Payload: map[string]any{"cmd": "rm -rf /"}, ExpiresAt: "2026-09-26T00:00:00.000Z"})
	if !executed || res.Status != model.ResultFailed || !strings.Contains(res.Error, "unsupported command type") {
		t.Fatalf("got %+v", res)
	}
	// Registering a handler for an unknown type is refused.
	d.Register("RUN_SHELL", func(context.Context, model.AgentCommand) model.CommandResult { return model.CommandResult{} })
	if _, ok := d.handlers["RUN_SHELL"]; ok {
		t.Fatal("unknown handler registered")
	}
}

func TestRejectsExpired(t *testing.T) {
	d, calls := newTestDispatcher(t)
	res, _ := d.Execute(context.Background(), model.AgentCommand{ID: "2", Type: model.CmdCollectInventory, ExpiresAt: "2026-09-25T09:59:59.000Z"})
	if res.Status != model.ResultFailed || !strings.Contains(res.Error, "expired") || *calls != 0 {
		t.Fatalf("got %+v calls=%d", res, *calls)
	}
	res, _ = d.Execute(context.Background(), model.AgentCommand{ID: "3", Type: model.CmdCollectInventory, ExpiresAt: "not-a-date"})
	if res.Status != model.ResultFailed || *calls != 0 {
		t.Fatalf("invalid expiry must fail: %+v", res)
	}
}

func TestExecutesValidAndDeduplicates(t *testing.T) {
	d, calls := newTestDispatcher(t)
	cmd := model.AgentCommand{ID: "4", Type: model.CmdCollectInventory, ExpiresAt: "2026-09-25T11:00:00.000Z"}
	res, executed := d.Execute(context.Background(), cmd)
	if !executed || res.Status != model.ResultSucceeded || *calls != 1 {
		t.Fatalf("got %+v calls=%d", res, *calls)
	}
	if _, executed := d.Execute(context.Background(), cmd); executed || *calls != 1 {
		t.Fatal("duplicate delivery must not execute twice")
	}
	// Dedup survives a restart (persisted ids).
	d2 := NewDispatcher(nil, d.seenPath)
	if _, executed := d2.Execute(context.Background(), cmd); executed {
		t.Fatal("persisted dedup failed")
	}
}

func TestPanicIsReported(t *testing.T) {
	d, _ := newTestDispatcher(t)
	d.Register(model.CmdApplyPolicy, func(context.Context, model.AgentCommand) model.CommandResult { panic("boom") })
	res, _ := d.Execute(context.Background(), model.AgentCommand{ID: "5", Type: model.CmdApplyPolicy})
	if res.Status != model.ResultFailed || !strings.Contains(res.Error, "boom") {
		t.Fatalf("got %+v", res)
	}
}

func TestPayloadHelpers(t *testing.T) {
	p := map[string]any{"patchIds": []any{"KB5031455", " ", "RHSA-2024:1234"}, "delaySec": float64(120), "reboot": "if-required"}
	if got := PayloadStrings(p, "patchIds"); len(got) != 2 {
		t.Fatalf("PayloadStrings = %v", got)
	}
	if PayloadInt(p, "delaySec", 0) != 120 || PayloadString(p, "reboot", "never") != "if-required" {
		t.Fatal("payload parsing")
	}
	ok, bad := SafeArgs([]string{"openssl", "RHSA-2024:1234", "--config=/tmp/x", "a;rm -rf /", "macOS Sonoma 14.4.1-23E224"})
	if len(ok) != 3 || len(bad) != 2 {
		t.Fatalf("SafeArgs ok=%v bad=%v", ok, bad)
	}
	if restartDelay(0) != 30 || restartDelay(600) != 600 {
		t.Fatal("restartDelay")
	}
}
