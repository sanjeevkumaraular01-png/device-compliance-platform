//go:build linux

package ipc

import (
	"net"
	"os/user"
	"strconv"

	"golang.org/x/sys/unix"
)

// PeerUser returns the username of the process on the other end of a Unix
// socket (SO_PEERCRED), so a helper cannot report activity as another user.
func PeerUser(c net.Conn) string {
	uc, ok := c.(*net.UnixConn)
	if !ok {
		return ""
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return ""
	}
	var cred *unix.Ucred
	_ = raw.Control(func(fd uintptr) {
		cred, _ = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	})
	if cred == nil {
		return ""
	}
	if u, err := user.LookupId(strconv.Itoa(int(cred.Uid))); err == nil {
		return u.Username
	}
	return ""
}
