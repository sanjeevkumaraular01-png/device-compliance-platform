// Package platform holds OS-specific paths, privilege checks, secure file
// writing and a context-aware command runner used by every other package.
package platform

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// EnvDataDir overrides the data directory (tests, portable runs).
const EnvDataDir = "SEM_AGENT_DATA_DIR"

// DataDir returns the directory holding config, keys, spool, state and logs.
func DataDir() string {
	if d := os.Getenv(EnvDataDir); d != "" {
		return d
	}
	return defaultDataDir()
}

// ConfigPath is the agent config file.
func ConfigPath() string { return filepath.Join(DataDir(), "agent.json") }

// LogDir is where rotated JSON logs are written.
func LogDir() string {
	if d := os.Getenv(EnvDataDir); d != "" {
		return filepath.Join(d, "logs")
	}
	return defaultLogDir()
}

// StateDir holds the offline spool, software snapshot and other runtime state.
func StateDir() string {
	if d := os.Getenv(EnvDataDir); d != "" {
		return filepath.Join(d, "state")
	}
	return defaultStateDir()
}

// StatePath returns a path for an agent state file inside the state dir.
func StatePath(name string) string { return filepath.Join(StateDir(), name) }

// EnsureDataDir creates the config, state and log directories with
// restrictive permissions.
func EnsureDataDir() error {
	for _, d := range []string{DataDir(), StateDir(), LogDir()} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
		if err := secureDir(d); err != nil {
			return err
		}
	}
	return nil
}

// WriteFileSecure atomically writes data readable only by SYSTEM/root
// (Windows: DACL SYSTEM + Administrators; Unix: mode 0600).
func WriteFileSecure(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := secureFile(tmp); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// WriteFileIfChanged writes data with the given mode only when the content
// differs. It reports whether the file was changed (for idempotent enforcement).
func WriteFileIfChanged(path string, data []byte, mode os.FileMode) (bool, error) {
	if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, data) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	tmp := path + ".sem-tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	return true, nil
}

// DefaultCmdTimeout bounds every external probe that does not pass its own.
const DefaultCmdTimeout = 30 * time.Second

// ErrNotFound is returned by Run when the executable does not exist.
var ErrNotFound = errors.New("executable not found")

// Run executes name with args, bounded by timeout (and ctx), and returns
// trimmed stdout. A non-zero exit returns stdout along with an error that
// includes stderr.
func Run(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	out, _, err := run(ctx, timeout, nil, nil, name, args...)
	return out, err
}

// RunEnv is Run with extra environment variables.
func RunEnv(ctx context.Context, timeout time.Duration, env []string, name string, args ...string) (string, error) {
	out, _, err := run(ctx, timeout, env, nil, name, args...)
	return out, err
}

// RunCombined returns stdout+stderr combined (for command output reporting).
func RunCombined(ctx context.Context, timeout time.Duration, env []string, name string, args ...string) (string, error) {
	out, stderr, err := run(ctx, timeout, env, nil, name, args...)
	combined := strings.TrimSpace(strings.TrimSpace(out) + "\n" + strings.TrimSpace(stderr))
	return combined, err
}

// RunStdin runs a command feeding stdin.
func RunStdin(ctx context.Context, timeout time.Duration, stdin []byte, name string, args ...string) (string, error) {
	out, _, err := run(ctx, timeout, nil, stdin, name, args...)
	return out, err
}

// ExitCode extracts the process exit code from an error returned by Run
// (-1 when unavailable).
func ExitCode(err error) int {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	var ce *CmdError
	if errors.As(err, &ce) {
		return ce.Code
	}
	if err == nil {
		return 0
	}
	return -1
}

// CmdError describes a failed command.
type CmdError struct {
	Name   string
	Code   int
	Stderr string
	Err    error
}

func (e *CmdError) Error() string {
	s := strings.TrimSpace(e.Stderr)
	if len(s) > 400 {
		s = s[:400] + "…"
	}
	if s != "" {
		return fmt.Sprintf("%s: %v: %s", e.Name, e.Err, s)
	}
	return fmt.Sprintf("%s: %v", e.Name, e.Err)
}

func (e *CmdError) Unwrap() error { return e.Err }

func run(ctx context.Context, timeout time.Duration, env []string, stdin []byte, name string, args ...string) (string, string, error) {
	if timeout <= 0 {
		timeout = DefaultCmdTimeout
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", "", fmt.Errorf("%s: %w", name, ErrNotFound)
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, path, args...)
	hideWindow(cmd)
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if cctx.Err() == context.DeadlineExceeded {
		return stdout.String(), stderr.String(), &CmdError{Name: name, Code: -1, Stderr: stderr.String(), Err: fmt.Errorf("timed out after %s", timeout)}
	}
	if err != nil {
		return strings.TrimSpace(stdout.String()), stderr.String(), &CmdError{Name: name, Code: ExitCode(err), Stderr: stderr.String(), Err: err}
	}
	return strings.TrimSpace(stdout.String()), stderr.String(), nil
}

// Exists reports whether a path exists.
func Exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// HasCommand reports whether an executable is on PATH.
func HasCommand(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
