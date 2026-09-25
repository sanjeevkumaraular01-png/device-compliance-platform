package service

import (
	"context"
	"errors"
	"log/slog"
	"runtime"
	"time"

	"github.com/kardianos/service"
)

// Service identity per OS.
const (
	WindowsServiceName = "SecureEndpointAgent"
	LinuxServiceName   = "sem-agent"
	MacServiceName     = "com.secureendpoint.agent"
	DisplayName        = "SecureEndpoint Agent"
	Description        = "SecureEndpoint Manager endpoint compliance agent (inventory, security posture, USB and software policy enforcement)."
)

// Name returns the platform service name.
func Name() string {
	switch runtime.GOOS {
	case "windows":
		return WindowsServiceName
	case "darwin":
		return MacServiceName
	default:
		return LinuxServiceName
	}
}

// SystemdUnit is the hardened unit used by "sem-agent install" (kardianos
// template syntax). packaging/linux/install.sh writes an equivalent file.
//
// ProtectSystem=strict / ProtectKernelTunables are intentionally NOT used:
// the agent must write udev rules, dconf/apt configuration, run package
// managers and toggle /sys/bus/usb/.../authorized.
const SystemdUnit = `[Unit]
Description={{.Description}}
Documentation=https://sem.example.com/docs/agent
After=network-online.target systemd-udevd.service
Wants=network-online.target
ConditionFileIsExecutable={{.Path|cmdEscape}}

[Service]
Type=simple
ExecStart={{.Path|cmdEscape}}{{range .Arguments}} {{.|cmd}}{{end}}
Restart=always
RestartSec=10
TimeoutStopSec=30
KillMode=mixed
UMask=0077
PrivateTmp=yes
ProtectHome=read-only
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
LockPersonality=yes
RestrictRealtime=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallArchitectures=native
LimitNOFILE=16384
StateDirectory=sem-agent
LogsDirectory=sem-agent
ConfigurationDirectory=sem-agent
ConfigurationDirectoryMode=0700
StateDirectoryMode=0700
LogsDirectoryMode=0700

[Install]
WantedBy=multi-user.target
`

// Config returns the kardianos service configuration.
func Config() *service.Config {
	opts := service.KeyValue{}
	switch runtime.GOOS {
	case "windows":
		opts["StartType"] = "automatic"
		opts["OnFailure"] = "restart"
		opts["OnFailureDelayDuration"] = "10s"
		opts["OnFailureResetPeriod"] = 86400
	case "darwin":
		opts["KeepAlive"] = true
		opts["RunAtLoad"] = true
		opts["SessionCreate"] = false
	default:
		opts["SystemdScript"] = SystemdUnit
		opts["Restart"] = "always"
	}
	return &service.Config{
		Name:        Name(),
		DisplayName: DisplayName,
		Description: Description,
		Arguments:   []string{"run"},
		Option:      opts,
	}
}

// program adapts Agent to kardianos/service.
type program struct {
	newAgent func() (*Agent, error)
	log      *slog.Logger
	cancel   context.CancelFunc
	done     chan struct{}
}

func (p *program) Start(s service.Service) error {
	a, err := p.newAgent()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.done = make(chan struct{})
	go func() {
		defer close(p.done)
		defer func() {
			if r := recover(); r != nil {
				p.log.Error("agent crashed", "panic", r)
			}
		}()
		if err := a.Run(ctx); err != nil {
			p.log.Error("agent stopped with error", "err", err.Error())
		}
	}()
	return nil
}

func (p *program) Stop(s service.Service) error {
	if p.cancel != nil {
		p.cancel()
		select {
		case <-p.done:
		case <-time.After(20 * time.Second):
			p.log.Warn("agent did not stop within 20s")
		}
	}
	return nil
}

// New returns the kardianos service bound to the agent factory.
func New(version string, log *slog.Logger) (service.Service, error) {
	p := &program{log: log, newAgent: func() (*Agent, error) { return NewAgent(version, log) }}
	return service.New(p, Config())
}

// Control runs install/uninstall/start/stop/restart.
func Control(action string) error {
	s, err := service.New(&program{log: slog.Default()}, Config())
	if err != nil {
		return err
	}
	return service.Control(s, action)
}

// Status returns a human-readable service state.
func Status() (string, error) {
	s, err := service.New(&program{log: slog.Default()}, Config())
	if err != nil {
		return "", err
	}
	st, err := s.Status()
	if err != nil {
		if errors.Is(err, service.ErrNotInstalled) {
			return "not installed", nil
		}
		return "unknown", err
	}
	switch st {
	case service.StatusRunning:
		return "running", nil
	case service.StatusStopped:
		return "stopped", nil
	default:
		return "unknown", nil
	}
}

// Interactive reports whether we run from a terminal (not under the SCM/systemd/launchd).
func Interactive() bool { return service.Interactive() }
