package pki

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// signCSR plays the server's CA: it signs csrPEM with a throwaway CA key.
func signCSR(t *testing.T, csrPEM []byte, notAfter time.Time) []byte {
	t.Helper()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * 365 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, _ := x509.ParseCertificate(caDER)
	blk, _ := pem.Decode(csrPEM)
	csr, err := x509.ParseCertificateRequest(blk.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: csr.Subject,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: notAfter,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, leaf, ca, csr.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func issue(t *testing.T, cn string, notAfter time.Time) (certPEM, keyPEM []byte) {
	t.Helper()
	keyPEM, csrPEM, err := GenerateKeyAndCSR(cn)
	if err != nil {
		t.Fatal(err)
	}
	return signCSR(t, csrPEM, notAfter), keyPEM
}

func TestNeedsRenewal(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()

	if due, _ := NeedsRenewal("", now, RenewalWindow); !due {
		t.Error("no certificate configured should be due")
	}
	if due, _ := NeedsRenewal(filepath.Join(dir, "missing.crt"), now, RenewalWindow); !due {
		t.Error("missing certificate file should be due")
	}

	fresh := filepath.Join(dir, "fresh.crt")
	c, _ := issue(t, "dev", now.Add(300*24*time.Hour))
	if err := os.WriteFile(fresh, c, 0o600); err != nil {
		t.Fatal(err)
	}
	if due, _ := NeedsRenewal(fresh, now, RenewalWindow); due {
		t.Error("certificate valid for 300 days should not be due")
	}

	soon := filepath.Join(dir, "soon.crt")
	c, _ = issue(t, "dev", now.Add(10*24*time.Hour))
	if err := os.WriteFile(soon, c, 0o600); err != nil {
		t.Fatal(err)
	}
	if due, _ := NeedsRenewal(soon, now, RenewalWindow); !due {
		t.Error("certificate expiring in 10 days should be due")
	}
}

func TestInstallPairReplacesMatchingPair(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "device.crt"), filepath.Join(dir, "device.key")
	oldCert, oldKey := issue(t, "dev", time.Now().Add(5*24*time.Hour))
	if err := os.WriteFile(certFile, oldCert, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, oldKey, 0o600); err != nil {
		t.Fatal(err)
	}

	want := time.Now().Add(365 * 24 * time.Hour).Truncate(time.Second)
	newCert, newKey := issue(t, "dev", want)
	got, err := InstallPair(certFile, keyFile, newCert, newKey)
	if err != nil {
		t.Fatalf("InstallPair: %v", err)
	}
	if !got.Equal(want.UTC()) && !got.Equal(want) {
		t.Errorf("notAfter = %v, want %v", got, want)
	}
	if _, err := ValidatePair(certFile, keyFile); err != nil {
		t.Errorf("installed pair does not match: %v", err)
	}
	for _, leftover := range []string{certFile + ".new", keyFile + ".new"} {
		if _, err := os.Stat(leftover); err == nil {
			t.Errorf("%s left behind", leftover)
		}
	}
}

func TestInstallPairRejectsMismatchAndKeepsOldPair(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "device.crt"), filepath.Join(dir, "device.key")
	oldCert, oldKey := issue(t, "dev", time.Now().Add(5*24*time.Hour))
	if err := os.WriteFile(certFile, oldCert, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, oldKey, 0o600); err != nil {
		t.Fatal(err)
	}

	// Certificate issued for a different key than the one we would install.
	otherCert, _ := issue(t, "dev", time.Now().Add(365*24*time.Hour))
	unrelatedKey, _, err := GenerateKeyAndCSR("dev")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InstallPair(certFile, keyFile, otherCert, unrelatedKey); err == nil {
		t.Fatal("expected mismatch error")
	}
	if _, err := ValidatePair(certFile, keyFile); err != nil {
		t.Errorf("old pair was damaged: %v", err)
	}
	if b, _ := os.ReadFile(certFile); string(b) != string(oldCert) {
		t.Error("old certificate was replaced despite the mismatch")
	}
}
