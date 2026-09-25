//go:build windows

package collector

import (
	"strconv"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// RegString reads a value as string (REG_SZ/EXPAND_SZ, or a DWORD/QWORD
// formatted in decimal). ok=false if the key/value does not exist.
func RegString(root registry.Key, path, name string) (string, bool) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "", false
	}
	defer k.Close()
	return regValueString(k, name)
}

func regValueString(k registry.Key, name string) (string, bool) {
	if s, _, err := k.GetStringValue(name); err == nil {
		return s, true
	}
	if v, _, err := k.GetIntegerValue(name); err == nil {
		return strconv.FormatUint(v, 10), true
	}
	return "", false
}

// RegInt reads a DWORD/QWORD (or a numeric string).
func RegInt(root registry.Key, path, name string) (int64, bool) {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return 0, false
	}
	defer k.Close()
	if v, _, err := k.GetIntegerValue(name); err == nil {
		return int64(v), true
	}
	if s, _, err := k.GetStringValue(name); err == nil {
		if v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
			return v, true
		}
	}
	return 0, false
}

// RegKeyExists reports whether a key exists.
func RegKeyExists(root registry.Key, path string) bool {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

// LoadedUserSIDs returns SIDs of user profiles whose hives are loaded under
// HKEY_USERS (i.e. logged-on users), excluding *_Classes and service accounts.
func LoadedUserSIDs() []string {
	k, err := registry.OpenKey(registry.USERS, "", registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return nil
	}
	var out []string
	for _, n := range names {
		// S-1-5-21-* local/AD accounts, S-1-12-1-* Entra ID (Azure AD) accounts.
		if (strings.HasPrefix(n, "S-1-5-21-") || strings.HasPrefix(n, "S-1-12-1-")) && !strings.HasSuffix(n, "_Classes") {
			out = append(out, n)
		}
	}
	return out
}
