// Package logging configures structured JSON logging to a rotated file in
// the platform log directory (plus stderr when running in the foreground).
package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/secureendpoint/agent/internal/platform"
)

// Options configures logging.
type Options struct {
	ToStderr bool   // also log to stderr (foreground runs)
	Level    string // debug|info|warn|error (default info; env SEM_AGENT_LOG_LEVEL overrides)
	File     bool   // write to the rotated log file
}

// Setup installs and returns the default logger. The returned closer flushes
// and closes the log file.
func Setup(o Options) (*slog.Logger, io.Closer) {
	var writers []io.Writer
	var closer io.Closer = nopCloser{}
	if o.File {
		dir := platform.LogDir()
		if err := os.MkdirAll(dir, 0o700); err == nil {
			lj := &lumberjack.Logger{
				Filename:   filepath.Join(dir, "agent.log"),
				MaxSize:    10, // MB
				MaxBackups: 5,
				MaxAge:     30, // days
				Compress:   true,
			}
			writers = append(writers, lj)
			closer = lj
		}
	}
	if o.ToStderr || len(writers) == 0 {
		writers = append(writers, os.Stderr)
	}
	lvl := parseLevel(o.Level)
	if env := os.Getenv("SEM_AGENT_LOG_LEVEL"); env != "" {
		lvl = parseLevel(env)
	}
	h := slog.NewJSONHandler(io.MultiWriter(writers...), &slog.HandlerOptions{Level: lvl})
	l := slog.New(h).With("component", "sem-agent")
	slog.SetDefault(l)
	return l, closer
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

type nopCloser struct{}

func (nopCloser) Close() error { return nil }

// Discard returns a logger that drops everything.
func Discard() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }
