// Package config loads and saves the agent configuration file
// (C:\ProgramData\SecureEndpoint\agent.json, /etc/sem-agent/agent.json,
// /Library/Application Support/SecureEndpoint/agent.json).
//
// The agent token is protected at rest: DPAPI (machine scope) on Windows plus a
// SYSTEM/Administrators-only DACL; mode 0600 owned by root on Linux/macOS.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// ErrNotEnrolled is returned when no config file exists.
var ErrNotEnrolled = errors.New("agent is not enrolled (run: sem-agent enroll --server URL --token TOKEN)")

// Config is the persisted agent configuration.
type Config struct {
	ServerURL          string             `json:"serverUrl"`
	DeviceID           string             `json:"deviceId"`
	Status             string             `json:"status,omitempty"`
	CertFile           string             `json:"certFile,omitempty"`
	KeyFile            string             `json:"keyFile,omitempty"`
	EnrollCAFile       string             `json:"enrollCaFile,omitempty"` // CA returned by /agent/enroll
	CAFile             string             `json:"caFile,omitempty"`       // extra server-trust CA (--ca-file)
	InsecureSkipVerify bool               `json:"insecureSkipVerify,omitempty"`
	GzipRequests       bool               `json:"gzipRequests,omitempty"`
	CheckinIntervalSec int                `json:"checkinIntervalSec,omitempty"`
	EnrolledAt         string             `json:"enrolledAt,omitempty"`
	Policy             *model.AgentPolicy `json:"policy,omitempty"`

	// AgentToken is the plaintext bearer token (memory only).
	AgentToken string `json:"-"`
}

// fileFormat is the on-disk shape: identical to Config plus the protected token.
type fileFormat struct {
	Config
	ProtectedToken string `json:"agentToken"`
}

// Load reads the config at path (platform.ConfigPath() when empty).
func Load(path string) (*Config, error) {
	if path == "" {
		path = platform.ConfigPath()
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotEnrolled
		}
		return nil, err
	}
	var ff fileFormat
	if err := json.Unmarshal(b, &ff); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	c := ff.Config
	tok, err := unprotectToken(ff.ProtectedToken)
	if err != nil {
		return nil, fmt.Errorf("decrypt agent token: %w", err)
	}
	c.AgentToken = tok
	return &c, nil
}

// Save writes the config atomically with restrictive permissions.
func (c *Config) Save(path string) error {
	if path == "" {
		path = platform.ConfigPath()
	}
	pt, err := protectToken(c.AgentToken)
	if err != nil {
		return fmt.Errorf("protect agent token: %w", err)
	}
	b, err := json.MarshalIndent(fileFormat{Config: *c, ProtectedToken: pt}, "", "  ")
	if err != nil {
		return err
	}
	return platform.WriteFileSecure(path, b)
}

// Enrolled reports whether the config has credentials.
func (c *Config) Enrolled() bool { return c != nil && c.DeviceID != "" && c.AgentToken != "" }

// NormalizeServerURL trims trailing slashes and any /api/v1 suffix.
func NormalizeServerURL(u string) string {
	u = strings.TrimSpace(u)
	u = strings.TrimRight(u, "/")
	u = strings.TrimSuffix(u, "/api/v1")
	return strings.TrimRight(u, "/")
}

const plainPrefix = "plain:"

func unprotectPlain(s string) string { return strings.TrimPrefix(s, plainPrefix) }
