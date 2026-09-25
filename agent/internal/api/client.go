// Package api is the agent's HTTP client for the SecureEndpoint backend
// (/api/v1/agent/*): TLS 1.2+, optional custom CA and mTLS client
// certificate, bearer token + X-Device-Id headers, retries with exponential
// backoff and jitter, optional gzip request bodies and an offline spool.
package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// Options configures a Client.
type Options struct {
	ServerURL          string // https://sem.example.com (without /api/v1)
	DeviceID           string
	Token              string
	CAFiles            []string // extra PEM CAs trusted for the server (in addition to system roots)
	CertFile, KeyFile  string   // client certificate for mTLS (optional)
	InsecureSkipVerify bool
	Gzip               bool
	UserAgent          string
	Timeout            time.Duration // per attempt (default 60s)
	MaxRetries         int           // default 4
	BaseBackoff        time.Duration // default 1s
	MaxBackoff         time.Duration // default 60s
	HTTPClient         *http.Client  // override (tests)
	Logger             *slog.Logger
}

// Client talks to the backend.
type Client struct {
	base   string
	opts   Options
	hc     *http.Client
	log    *slog.Logger
	sleep  func(ctx context.Context, d time.Duration) error
	random *rand.Rand
	// clientCert is served to the server during TLS handshakes (mTLS) and can be
	// swapped at runtime after a certificate renewal.
	clientCert atomic.Pointer[tls.Certificate]
}

// APIError is a non-2xx response.
type APIError struct {
	StatusCode int
	Message    string
	Path       string
	RetryAfter time.Duration
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("%s: HTTP %d: %s", e.Path, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("%s: HTTP %d", e.Path, e.StatusCode)
}

// IsUnauthorized reports a 401 (token revoked / device retired).
func IsUnauthorized(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && ae.StatusCode == http.StatusUnauthorized
}

// IsPermanent reports an error that retrying (or spooling) will not fix,
// i.e. a 4xx other than 401/408/429.
func IsPermanent(err error) bool {
	var ae *APIError
	if !errors.As(err, &ae) {
		return false
	}
	switch ae.StatusCode {
	case http.StatusUnauthorized, http.StatusRequestTimeout, http.StatusTooManyRequests:
		return false
	}
	return ae.StatusCode >= 400 && ae.StatusCode < 500
}

func retryable(err error) bool {
	if err == nil {
		return false
	}
	var ae *APIError
	if errors.As(err, &ae) {
		return ae.StatusCode >= 500 || ae.StatusCode == http.StatusTooManyRequests || ae.StatusCode == http.StatusRequestTimeout
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		// x509 / TLS configuration errors never heal by retrying.
		var ce *tls.CertificateVerificationError
		if errors.As(err, &ce) {
			return false
		}
		var uae x509.UnknownAuthorityError
		if errors.As(err, &uae) {
			return false
		}
		return true
	}
	var ne net.Error
	return errors.As(err, &ne)
}

// New builds a client.
func New(opts Options) (*Client, error) {
	if opts.ServerURL == "" {
		return nil, errors.New("server URL is required")
	}
	u, err := url.Parse(opts.ServerURL)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid server URL %q", opts.ServerURL)
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 60 * time.Second
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 4
	}
	if opts.MaxRetries < 0 {
		opts.MaxRetries = 0
	}
	if opts.BaseBackoff <= 0 {
		opts.BaseBackoff = time.Second
	}
	if opts.MaxBackoff <= 0 {
		opts.MaxBackoff = 60 * time.Second
	}
	if opts.UserAgent == "" {
		opts.UserAgent = "sem-agent"
	}
	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	c := &Client{
		base:   strings.TrimRight(opts.ServerURL, "/") + "/api/v1",
		opts:   opts,
		log:    log,
		sleep:  sleepCtx,
		random: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	hc := opts.HTTPClient
	if hc == nil {
		tlsCfg, err := buildTLS(opts)
		if err != nil {
			return nil, err
		}
		// mTLS is optional (the bearer token authenticates the agent), so an
		// unreadable certificate is logged rather than stopping the agent.
		if err := c.ReloadClientCertificate(); err != nil {
			log.Warn("client certificate not loaded; continuing without mTLS", "err", err)
		}
		tlsCfg.GetClientCertificate = func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
			if cert := c.clientCert.Load(); cert != nil {
				return cert, nil
			}
			return &tls.Certificate{}, nil
		}
		tr := &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			TLSClientConfig:       tlsCfg,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          4,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: opts.Timeout,
			DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		}
		hc = &http.Client{Transport: tr, Timeout: opts.Timeout}
	}
	c.hc = hc
	return c, nil
}

// ReloadClientCertificate (re)loads the mTLS client certificate from the
// configured files; new TLS handshakes use it immediately.
func (c *Client) ReloadClientCertificate() error {
	if c.opts.CertFile == "" || c.opts.KeyFile == "" {
		return nil
	}
	if _, err := os.Stat(c.opts.CertFile); err != nil {
		return nil // not issued (e.g. enrolled without a CSR)
	}
	cert, err := tls.LoadX509KeyPair(c.opts.CertFile, c.opts.KeyFile)
	if err != nil {
		return fmt.Errorf("load client certificate: %w", err)
	}
	c.clientCert.Store(&cert)
	// Kept-alive connections were authenticated with the old certificate.
	if c.hc != nil {
		if tr, ok := c.hc.Transport.(*http.Transport); ok {
			tr.CloseIdleConnections()
		}
	}
	return nil
}

func buildTLS(opts Options) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: opts.InsecureSkipVerify} //nolint:gosec // explicit opt-in flag
	if len(opts.CAFiles) > 0 {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		for _, f := range opts.CAFiles {
			if f == "" {
				continue
			}
			pem, err := os.ReadFile(f)
			if err != nil {
				return nil, fmt.Errorf("read CA file: %w", err)
			}
			if !pool.AppendCertsFromPEM(pem) {
				return nil, fmt.Errorf("no certificates found in %s", f)
			}
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// backoff returns the delay before retry number attempt (0-based):
// base*2^attempt capped at max, with "equal jitter" (between d/2 and d).
func (c *Client) backoff(attempt int) time.Duration {
	d := c.opts.BaseBackoff << uint(attempt)
	if d <= 0 || d > c.opts.MaxBackoff {
		d = c.opts.MaxBackoff
	}
	half := d / 2
	return half + time.Duration(c.random.Int63n(int64(half)+1))
}

// Do sends method path (relative to /api/v1) with a JSON body and decodes the
// JSON response into out (if non-nil). Retries transient failures.
func (c *Client) Do(ctx context.Context, method, path string, body any, out any) error {
	return c.do(ctx, method, path, body, out, true, c.opts.MaxRetries)
}

// DoRaw is Do with a pre-encoded JSON body (used by the spool).
func (c *Client) DoRaw(ctx context.Context, method, path string, raw json.RawMessage, out any) error {
	return c.do(ctx, method, path, raw, out, true, c.opts.MaxRetries)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any, auth bool, retries int) error {
	var payload []byte
	if body != nil {
		switch b := body.(type) {
		case json.RawMessage:
			payload = b
		default:
			var err error
			if payload, err = json.Marshal(body); err != nil {
				return err
			}
		}
	}
	var lastErr error
	for attempt := 0; ; attempt++ {
		lastErr = c.once(ctx, method, path, payload, out, auth)
		if lastErr == nil {
			return nil
		}
		if !retryable(lastErr) || attempt >= retries || ctx.Err() != nil {
			return lastErr
		}
		wait := c.backoff(attempt)
		var ae *APIError
		if errors.As(lastErr, &ae) && ae.RetryAfter > 0 {
			wait = ae.RetryAfter
			if wait > c.opts.MaxBackoff {
				wait = c.opts.MaxBackoff
			}
		}
		c.log.Debug("request failed, retrying", "path", path, "attempt", attempt+1, "wait", wait.String(), "err", lastErr.Error())
		if err := c.sleep(ctx, wait); err != nil {
			return lastErr
		}
	}
}

func (c *Client) once(ctx context.Context, method, path string, payload []byte, out any, auth bool) error {
	var rdr io.Reader
	gz := false
	if payload != nil {
		if c.opts.Gzip && len(payload) > 1024 {
			var buf bytes.Buffer
			zw := gzip.NewWriter(&buf)
			_, _ = zw.Write(payload)
			_ = zw.Close()
			rdr = &buf
			gz = true
		} else {
			rdr = bytes.NewReader(payload)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.opts.UserAgent)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
		if gz {
			req.Header.Set("Content-Encoding", "gzip")
		}
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.opts.Token)
		req.Header.Set("X-Device-Id", c.opts.DeviceID)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		ae := &APIError{StatusCode: resp.StatusCode, Path: path, Message: errorMessage(data)}
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if s, err := strconv.Atoi(ra); err == nil {
				ae.RetryAfter = time.Duration(s) * time.Second
			}
		}
		return ae
	}
	if out != nil && len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode %s response: %w", path, err)
		}
	}
	return nil
}

func errorMessage(data []byte) string {
	var e struct {
		Message any `json:"message"`
	}
	if json.Unmarshal(data, &e) == nil && e.Message != nil {
		switch m := e.Message.(type) {
		case string:
			return m
		case []any:
			parts := make([]string, 0, len(m))
			for _, p := range m {
				parts = append(parts, fmt.Sprint(p))
			}
			return strings.Join(parts, "; ")
		}
	}
	s := strings.TrimSpace(string(data))
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

// --- typed endpoints -------------------------------------------------------

// Enroll registers the device (no bearer auth; a couple of retries only).
func (c *Client) Enroll(ctx context.Context, req model.EnrollRequest) (*model.EnrollResponse, error) {
	var out model.EnrollResponse
	if err := c.do(ctx, http.MethodPost, "/agent/enroll", req, &out, false, 2); err != nil {
		return nil, err
	}
	return &out, nil
}

// Heartbeat checks in and receives policy + pending commands.
func (c *Client) Heartbeat(ctx context.Context, req model.HeartbeatRequest) (*model.HeartbeatResponse, error) {
	var out model.HeartbeatResponse
	if err := c.Do(ctx, http.MethodPost, "/agent/heartbeat", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Report uploads full device state.
func (c *Client) Report(ctx context.Context, r *model.Report) (*model.ReportResponse, error) {
	var out model.ReportResponse
	if err := c.Do(ctx, http.MethodPost, "/agent/report", r, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RenewCertificate asks the server to sign a new CSR for this device.
func (c *Client) RenewCertificate(ctx context.Context, csrPEM []byte) (*model.RenewCertificateResponse, error) {
	var out model.RenewCertificateResponse
	if err := c.Do(ctx, http.MethodPost, "/agent/certificate/renew", model.RenewCertificateRequest{CsrPem: string(csrPEM)}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Policy fetches the effective policy.
func (c *Client) Policy(ctx context.Context) (*model.AgentPolicy, error) {
	var out model.AgentPolicy
	if err := c.Do(ctx, http.MethodGet, "/agent/policy", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Paths used by the spool.
const (
	PathUsbEvents      = "/agent/usb-events"
	PathSoftwareEvents = "/agent/software-events"
	PathActivity       = "/agent/activity"
)

// ScreenshotUpload is one blurred-if-required JPEG for POST /agent/screenshots.
type ScreenshotUpload struct {
	JPEG       []byte
	CapturedAt time.Time
	OSUser     string
	ActiveApp  string
	Blurred    bool
}

// UploadScreenshot sends a screenshot as multipart/form-data. Not spooled:
// a screenshot that cannot be delivered now is dropped.
func (c *Client) UploadScreenshot(ctx context.Context, s ScreenshotUpload) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fields := map[string]string{
		"capturedAt": s.CapturedAt.UTC().Format(time.RFC3339),
		"osUser":     s.OSUser,
		"activeApp":  s.ActiveApp,
		"blurred":    strconv.FormatBool(s.Blurred),
	}
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return err
		}
	}
	part, err := mw.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="image"; filename="screenshot.jpg"`},
		"Content-Type":        {"image/jpeg"},
	})
	if err != nil {
		return err
	}
	if _, err := part.Write(s.JPEG); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/agent/screenshots", &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.opts.UserAgent)
	req.Header.Set("Authorization", "Bearer "+c.opts.Token)
	req.Header.Set("X-Device-Id", c.opts.DeviceID)
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &APIError{StatusCode: resp.StatusCode, Path: "/agent/screenshots", Message: errorMessage(data)}
	}
	return nil
}

// CommandResultPath returns the result path for a command id.
func CommandResultPath(id string) string {
	return "/agent/commands/" + url.PathEscape(id) + "/result"
}

// UsbEvents posts USB events.
func (c *Client) UsbEvents(ctx context.Context, events []model.UsbEvent) error {
	return c.Do(ctx, http.MethodPost, PathUsbEvents, map[string]any{"events": events}, nil)
}

// SoftwareEvents posts software events.
func (c *Client) SoftwareEvents(ctx context.Context, events []model.SoftwareEvent) error {
	return c.Do(ctx, http.MethodPost, PathSoftwareEvents, map[string]any{"events": events}, nil)
}

// CommandResult posts a command outcome.
func (c *Client) CommandResult(ctx context.Context, id string, res model.CommandResult) error {
	return c.Do(ctx, http.MethodPost, CommandResultPath(id), res, nil)
}
