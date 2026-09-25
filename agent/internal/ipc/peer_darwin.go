//go:build darwin

package ipc

import (
	"net"
	"os/user"
	"strconv"

	"golang.org/x/sys/unix"
)

// PeerUser returns the username of the connected helper (LOCAL_PEERCRED).
func PeerUser(c net.Conn) string {
	uc, ok := c.(*net.UnixConn)
	if !ok {
		return ""
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return ""
	}
	var cred *unix.Xucred
	_ = raw.Control(func(fd uintptr) {
		cred, _ = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	})
	if cred == nil {
		return ""
	}
	if u, err := user.LookupId(strconv.Itoa(int(cred.Uid))); err == nil {
		return u.Username
	}
	return ""
}
