//go:build windows

package config

import (
	"encoding/base64"
	"errors"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const dpapiPrefix = "dpapi:"

// entropy binds the blob to this application.
var entropy = []byte("SecureEndpointAgent/v1")

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

// protectToken encrypts with DPAPI in machine scope so that both an elevated
// administrator (enroll) and LocalSystem (service) can decrypt it; the file
// DACL restricts who can read the blob in the first place.
func protectToken(tok string) (string, error) {
	if tok == "" {
		return "", nil
	}
	var out windows.DataBlob
	err := windows.CryptProtectData(blob([]byte(tok)), nil, blob(entropy), 0, nil,
		windows.CRYPTPROTECT_UI_FORBIDDEN|windows.CRYPTPROTECT_LOCAL_MACHINE, &out)
	if err != nil {
		return "", err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	enc := unsafe.Slice(out.Data, out.Size)
	return dpapiPrefix + base64.StdEncoding.EncodeToString(enc), nil
}

func unprotectToken(s string) (string, error) {
	if !strings.HasPrefix(s, dpapiPrefix) {
		return unprotectPlain(s), nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, dpapiPrefix))
	if err != nil {
		return "", err
	}
	if len(raw) == 0 {
		return "", errors.New("empty DPAPI blob")
	}
	var out windows.DataBlob
	err = windows.CryptUnprotectData(blob(raw), nil, blob(entropy), 0, nil,
		windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	if err != nil {
		return "", err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return string(unsafe.Slice(out.Data, out.Size)), nil
}
