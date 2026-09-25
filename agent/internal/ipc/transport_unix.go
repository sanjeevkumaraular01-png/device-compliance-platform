//go:build darwin || linux

package ipc

import (
	"context"
	"net"
	"os"
	"time"
)

// Address is the Unix socket the service listens on.
const Address = "/var/run/sem-agent.sock"

// Listen opens the service endpoint (world-connectable so helpers running as
// any signed-in user can reach it; the peer uid is checked where supported).
func Listen() (net.Listener, error) {
	_ = os.Remove(Address)
	l, err := net.Listen("unix", Address)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(Address, 0o666); err != nil {
		l.Close()
		return nil, err
	}
	return l, nil
}

// Dial connects a helper to the service.
func Dial(ctx context.Context) (net.Conn, error) {
	d := net.Dialer{Timeout: 5 * time.Second}
	return d.DialContext(ctx, "unix", Address)
}
