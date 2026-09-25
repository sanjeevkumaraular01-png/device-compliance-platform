package service

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/secureendpoint/agent/internal/pki"
	"github.com/secureendpoint/agent/internal/platform"
)

// certCheckInterval is how often the agent checks its device certificate.
const certCheckInterval = 24 * time.Hour

// maybeRenewCertificate requests a new device certificate when the current one
// is missing or expires within pki.RenewalWindow. The agent token authenticates
// the request, so an expired certificate can still be renewed.
func (a *Agent) maybeRenewCertificate(ctx context.Context) {
	a.mu.Lock()
	certFile, keyFile, deviceID := a.cfg.CertFile, a.cfg.KeyFile, a.cfg.DeviceID
	a.mu.Unlock()

	due, notAfter := pki.NeedsRenewal(certFile, time.Now(), pki.RenewalWindow)
	if !due {
		return
	}
	a.log.Info("device certificate renewal due", "expires", notAfter)
	if _, err := a.renewCertificate(ctx, certFile, keyFile, deviceID); err != nil {
		a.log.Warn("certificate renewal failed; will retry", "err", err)
	}
}

// ForceRenewCertificate renews the device certificate now, regardless of expiry.
func (a *Agent) ForceRenewCertificate(ctx context.Context) (time.Time, error) {
	a.mu.Lock()
	certFile, keyFile, deviceID := a.cfg.CertFile, a.cfg.KeyFile, a.cfg.DeviceID
	a.mu.Unlock()
	return a.renewCertificate(ctx, certFile, keyFile, deviceID)
}

// renewCertificate generates a new key, has the server sign it and installs the pair.
func (a *Agent) renewCertificate(ctx context.Context, certFile, keyFile, deviceID string) (time.Time, error) {
	keyPEM, csrPEM, err := pki.GenerateKeyAndCSR(deviceID)
	if err != nil {
		return time.Time{}, fmt.Errorf("generate key: %w", err)
	}
	resp, err := a.client.RenewCertificate(ctx, csrPEM)
	if err != nil {
		return time.Time{}, fmt.Errorf("renewal request: %w", err)
	}

	dir := platform.DataDir()
	if certFile == "" {
		certFile = filepath.Join(dir, "device.crt")
	}
	if keyFile == "" {
		keyFile = filepath.Join(dir, "device.key")
	}
	newNotAfter, err := pki.InstallPair(certFile, keyFile, []byte(resp.CertificatePem), keyPEM)
	if err != nil {
		return time.Time{}, fmt.Errorf("install certificate: %w", err)
	}

	a.mu.Lock()
	a.cfg.CertFile, a.cfg.KeyFile = certFile, keyFile
	err = a.cfg.Save("")
	a.mu.Unlock()
	if err != nil {
		a.log.Warn("certificate renewal: saving config failed", "err", err)
	}
	if err := a.client.ReloadClientCertificate(); err != nil {
		a.log.Warn("certificate renewal: reloading client certificate failed", "err", err)
	}
	a.log.Info("device certificate renewed", "expires", newNotAfter)
	return newNotAfter, nil
}
