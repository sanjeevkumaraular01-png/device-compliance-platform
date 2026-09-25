//go:build windows

package collector

import (
	"golang.org/x/sys/windows"
)

// activeSessionUser returns DOMAIN\user of the active console session
// (requires LocalSystem for WTSQueryUserToken; returns "" otherwise).
func activeSessionUser() string {
	sid := windows.WTSGetActiveConsoleSessionId()
	if sid == 0xFFFFFFFF {
		return ""
	}
	var tok windows.Token
	if err := windows.WTSQueryUserToken(sid, &tok); err != nil {
		return ""
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return ""
	}
	acct, dom, _, err := u.User.Sid.LookupAccount("")
	if err != nil {
		return ""
	}
	if dom != "" {
		return dom + `\` + acct
	}
	return acct
}
