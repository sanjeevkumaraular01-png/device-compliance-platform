//go:build !windows

package config

// On Linux/macOS the file itself is 0600 root-owned; the token is stored as-is.
func protectToken(tok string) (string, error) {
	if tok == "" {
		return "", nil
	}
	return plainPrefix + tok, nil
}

func unprotectToken(s string) (string, error) { return unprotectPlain(s), nil }
