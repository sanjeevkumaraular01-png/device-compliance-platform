//go:build windows

package ipc

import (
	"context"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

// Address is the named pipe the service listens on.
const Address = `\\.\pipe\sem-agent`

// pipeSDDL: SYSTEM and Administrators full control; interactive Authenticated
// Users may connect and read/write (helpers run as the signed-in user).
const pipeSDDL = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)"

// Listen opens the service endpoint.
func Listen() (net.Listener, error) {
	return winio.ListenPipe(Address, &winio.PipeConfig{SecurityDescriptor: pipeSDDL, InputBufferSize: 64 << 10, OutputBufferSize: 64 << 10})
}

// Dial connects a helper to the service.
func Dial(ctx context.Context) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return winio.DialPipeContext(ctx, Address)
}

// PeerUser is not derivable from a go-winio pipe connection; the service
// uses the user reported in the helper's hello (pipe is limited to
// authenticated users by pipeSDDL).
func PeerUser(net.Conn) string { return "" }
