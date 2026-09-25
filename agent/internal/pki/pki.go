// Package pki generates the device key pair and certificate signing request
// used during enrollment. RSA-2048 is used because the backend signs CSRs with
// node-forge, which only supports RSA.
package pki

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/secureendpoint/agent/internal/platform"
)

// KeyBits is the RSA modulus size.
const KeyBits = 2048

// GenerateKeyAndCSR creates an RSA key and a CSR with CN = commonName
// (the device serial number). Both are returned PEM-encoded.
func GenerateKeyAndCSR(commonName string) (keyPEM, csrPEM []byte, err error) {
	if commonName == "" {
		return nil, nil, errors.New("common name (serial number) is required")
	}
	key, err := rsa.GenerateKey(rand.Reader, KeyBits)
	if err != nil {
		return nil, nil, err
	}
	tmpl := &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: commonName, Organization: []string{"SecureEndpoint Agent"}},
		SignatureAlgorithm: x509.SHA256WithRSA,
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, tmpl, key)
	if err != nil {
		return nil, nil, err
	}
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	csrPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der})
	return keyPEM, csrPEM, nil
}

// SaveKey writes the private key readable by SYSTEM/root only.
func SaveKey(path string, keyPEM []byte) error { return platform.WriteFileSecure(path, keyPEM) }

// SaveCert writes a PEM certificate (public; still stored in the protected dir).
func SaveCert(path string, certPEM []byte) error { return platform.WriteFileSecure(path, certPEM) }

// ValidatePair checks that cert and key match and returns the cert expiry.
func ValidatePair(certFile, keyFile string) (time.Time, error) {
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return time.Time{}, err
	}
	if len(pair.Certificate) == 0 {
		return time.Time{}, errors.New("empty certificate chain")
	}
	c, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return time.Time{}, err
	}
	return c.NotAfter, nil
}

// RenewalWindow is how long before expiry the agent requests a new certificate.
const RenewalWindow = 30 * 24 * time.Hour

// NeedsRenewal reports whether the certificate at certFile is missing, unreadable
// or expires within window of now.
func NeedsRenewal(certFile string, now time.Time, window time.Duration) (bool, time.Time) {
	if certFile == "" {
		return true, time.Time{}
	}
	_, notAfter, err := CertInfo(certFile)
	if err != nil {
		return true, time.Time{}
	}
	return notAfter.Sub(now) <= window, notAfter
}

// InstallPair replaces certFile/keyFile with a new matching pair. Both are first
// written next to the targets and checked to belong together, so a bad response
// from the server can never leave a mismatched pair in place.
func InstallPair(certFile, keyFile string, certPEM, keyPEM []byte) (time.Time, error) {
	newCert, newKey := certFile+".new", keyFile+".new"
	cleanup := func() { _ = os.Remove(newCert); _ = os.Remove(newKey) }
	if err := SaveKey(newKey, keyPEM); err != nil {
		cleanup()
		return time.Time{}, err
	}
	if err := SaveCert(newCert, certPEM); err != nil {
		cleanup()
		return time.Time{}, err
	}
	notAfter, err := ValidatePair(newCert, newKey)
	if err != nil {
		cleanup()
		return time.Time{}, fmt.Errorf("renewed certificate does not match the new key: %w", err)
	}
	if err := os.Rename(newKey, keyFile); err != nil {
		cleanup()
		return time.Time{}, err
	}
	if err := os.Rename(newCert, certFile); err != nil {
		cleanup()
		return time.Time{}, err
	}
	return notAfter, nil
}

// CertInfo returns subject CN and expiry of a PEM certificate file.
func CertInfo(path string) (string, time.Time, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", time.Time{}, err
	}
	blk, _ := pem.Decode(b)
	if blk == nil {
		return "", time.Time{}, fmt.Errorf("%s: no PEM data", path)
	}
	c, err := x509.ParseCertificate(blk.Bytes)
	if err != nil {
		return "", time.Time{}, err
	}
	return c.Subject.CommonName, c.NotAfter, nil
}
