// Package commands executes server-issued AgentCommands. Only the fixed set of
// CommandType values is accepted, each mapped to a built-in handler: the
// server can never make the agent run an arbitrary shell command.
package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// Handler executes one command type.
type Handler func(ctx context.Context, cmd model.AgentCommand) model.CommandResult

// AllowedTypes is the whitelist of command types the agent understands.
var AllowedTypes = map[string]bool{
	model.CmdUninstallSoftware: true,
	model.CmdInstallPatches:    true,
	model.CmdApplyPolicy:       true,
	model.CmdCollectInventory:  true,
	model.CmdLockScreen:        true,
	model.CmdRestart:           true,
	model.CmdEnableEncryption:  true,
	model.CmdRefreshUsbRules:   true,
	model.CmdShutdown:          true,
}

// Dispatcher routes commands to handlers.
type Dispatcher struct {
	log      *slog.Logger
	handlers map[string]Handler
	now      func() time.Time
	seenPath string

	mu   sync.Mutex
	seen []string
}

// NewDispatcher returns a dispatcher with the platform handlers (lock,
// restart, encryption, patches) pre-registered. seenPath persists executed
// command ids to avoid double execution ("" = memory only).
func NewDispatcher(log *slog.Logger, seenPath string) *Dispatcher {
	if log == nil {
		log = slog.Default()
	}
	d := &Dispatcher{log: log, handlers: map[string]Handler{}, now: time.Now, seenPath: seenPath}
	if seenPath != "" {
		if b, err := os.ReadFile(seenPath); err == nil {
			_ = json.Unmarshal(b, &d.seen)
		}
	}
	d.Register(model.CmdLockScreen, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		return FromOutput(lockScreen(ctx, log))
	})
	d.Register(model.CmdRestart, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		delay := PayloadInt(c.Payload, "delaySec", 60)
		return FromOutput(restart(ctx, log, delay))
	})
	d.Register(model.CmdShutdown, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		delay := PayloadInt(c.Payload, "delaySec", 60)
		return FromOutput(shutdown(ctx, log, delay))
	})
	d.Register(model.CmdEnableEncryption, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		out, data, err := enableEncryption(ctx, log)
		r := FromOutput(out, err)
		r.Data = data
		return r
	})
	d.Register(model.CmdInstallPatches, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		req := PatchRequest{
			PatchIDs:   PayloadStrings(c.Payload, "patchIds"),
			Severities: PayloadStrings(c.Payload, "severity"),
			Reboot:     PayloadString(c.Payload, "reboot", "never"),
		}
		out, data, err := installPatches(ctx, log, req)
		r := FromOutput(out, err)
		r.Data = data
		return r
	})
	return d
}

// Register sets (or replaces) the handler for a command type. Types outside
// AllowedTypes are ignored.
func (d *Dispatcher) Register(typ string, h Handler) {
	if !AllowedTypes[typ] {
		d.log.Error("refusing to register handler for unknown command type", "type", typ)
		return
	}
	d.handlers[typ] = h
}

// Execute validates and runs a command. executed=false means the command was
// a duplicate delivery and no result should be posted.
func (d *Dispatcher) Execute(ctx context.Context, cmd model.AgentCommand) (res model.CommandResult, executed bool) {
	log := d.log.With("commandId", cmd.ID, "type", cmd.Type)
	if cmd.ID == "" {
		return Failed("command has no id"), true
	}
	if d.alreadySeen(cmd.ID) {
		log.Warn("duplicate command delivery ignored")
		return model.CommandResult{}, false
	}
	d.markSeen(cmd.ID)
	if !AllowedTypes[cmd.Type] {
		log.Warn("rejected unsupported command type")
		return Failed(fmt.Sprintf("unsupported command type %q", cmd.Type)), true
	}
	if cmd.ExpiresAt != "" {
		exp, err := time.Parse(time.RFC3339Nano, cmd.ExpiresAt)
		if err != nil {
			return Failed("invalid expiresAt: " + cmd.ExpiresAt), true
		}
		if !d.now().Before(exp) {
			log.Warn("rejected expired command", "expiresAt", cmd.ExpiresAt)
			return Failed("command expired at " + cmd.ExpiresAt), true
		}
	}
	h := d.handlers[cmd.Type]
	if h == nil {
		return Failed(fmt.Sprintf("command type %s is not supported on this platform", cmd.Type)), true
	}
	log.Info("executing command")
	start := time.Now()
	defer func() {
		if r := recover(); r != nil {
			log.Error("command handler panicked", "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			res, executed = Failed(fmt.Sprintf("internal error: %v", r)), true
		}
	}()
	res = h(ctx, cmd)
	if res.Status == "" {
		res.Status = model.ResultSucceeded
	}
	res.Output = truncate(res.Output, 64*1024)
	log.Info("command finished", "status", res.Status, "duration", time.Since(start).String(), "error", res.Error)
	return res, true
}

func (d *Dispatcher) alreadySeen(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, s := range d.seen {
		if s == id {
			return true
		}
	}
	return false
}

func (d *Dispatcher) markSeen(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seen = append(d.seen, id)
	if len(d.seen) > 500 {
		d.seen = d.seen[len(d.seen)-500:]
	}
	if d.seenPath != "" {
		if b, err := json.Marshal(d.seen); err == nil {
			_ = platform.WriteFileSecure(d.seenPath, b)
		}
	}
}

// Failed builds a FAILED result.
func Failed(msg string) model.CommandResult {
	return model.CommandResult{Status: model.ResultFailed, Error: msg}
}

// FromOutput builds a result from command output and error.
func FromOutput(out string, err error) model.CommandResult {
	if err != nil {
		return model.CommandResult{Status: model.ResultFailed, Output: out, Error: err.Error()}
	}
	return model.CommandResult{Status: model.ResultSucceeded, Output: out}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

// PayloadString reads a string payload field.
func PayloadString(p map[string]any, key, def string) string {
	if v, ok := p[key].(string); ok && v != "" {
		return v
	}
	return def
}

// PayloadInt reads a numeric payload field.
func PayloadInt(p map[string]any, key string, def int) int {
	switch v := p[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return def
}

// PayloadStrings reads a string-array payload field (a single string is accepted too).
func PayloadStrings(p map[string]any, key string) []string {
	switch v := p[key].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	case []string:
		return v
	case string:
		if v != "" {
			return []string{v}
		}
	}
	return nil
}

// PatchRequest is the parsed INSTALL_PATCHES payload.
type PatchRequest struct {
	PatchIDs   []string
	Severities []string
	Reboot     string // never | if-required
}

// safeArg rejects values that could be interpreted as options or contain
// shell/control characters (arguments are passed without a shell anyway).
var safeArgRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9+._:~@ ()\-]*$`)

// SafeArgs filters ids to those safe to pass as command arguments.
func SafeArgs(ids []string) (ok []string, rejected []string) {
	for _, id := range ids {
		if safeArgRE.MatchString(id) && len(id) < 200 {
			ok = append(ok, id)
		} else {
			rejected = append(rejected, id)
		}
	}
	return ok, rejected
}

// restartDelay clamps the restart delay so the result can be posted first.
func restartDelay(sec int) int {
	if sec < 30 {
		return 30
	}
	if sec > 86400 {
		return 86400
	}
	return sec
}
