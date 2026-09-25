// Command sem-agent is the SecureEndpoint Manager endpoint agent.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/activity"
	"github.com/secureendpoint/agent/internal/api"
	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/config"
	"github.com/secureendpoint/agent/internal/logging"
	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/pki"
	"github.com/secureendpoint/agent/internal/platform"
	"github.com/secureendpoint/agent/internal/service"
	"github.com/secureendpoint/agent/internal/usb"
)

// version is set at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

const usage = `SecureEndpoint agent %s (%s/%s)

Usage:
  sem-agent enroll --server https://sem.example.com --token sem_enr_xxx [--insecure-skip-verify] [--ca-file ca.pem] [--force]
  sem-agent run                  run in the foreground (also used by the OS service)
  sem-agent install              install the OS service (Windows Service / systemd / launchd)
  sem-agent uninstall            remove the OS service
  sem-agent start | stop | restart
  sem-agent status               service state, enrollment and connectivity summary
  sem-agent collect --json       print a full report without sending it [--skip-patches] [--skip-software] [--section hardware|security|software|patches]
  sem-agent usb                  list connected USB devices and the policy decision for each
  sem-agent reset-usb            remove all USB restrictions applied by the agent (used by uninstallers)
  sem-agent user-helper          per-user activity helper (started at logon; see docs/WORKFORCE.md)
  sem-agent integration install [--extension-id ID] | uninstall   register helper autostart + browser host
  sem-agent renew-cert           renew the device certificate now (the service also renews 30 days before expiry)
  sem-agent version

Files: config %s, logs %s
`

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}
	// Chrome/Edge launch native messaging hosts with the caller origin as argv[1].
	if activity.IsNativeHostInvocation(os.Args[1:]) {
		if err := activity.ServeNativeHost(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "enroll":
		err = cmdEnroll(args)
	case "run":
		err = cmdRun(args)
	case "install", "uninstall", "start", "stop", "restart":
		err = cmdControl(cmd, args)
	case "integration":
		err = cmdIntegration(args)
	case "user-helper":
		err = cmdUserHelper()
	case "native-host":
		err = activity.ServeNativeHost(os.Stdin, os.Stdout)
	case "status":
		err = cmdStatus()
	case "collect":
		err = cmdCollect(args)
	case "usb":
		err = cmdUSB()
	case "reset-usb":
		err = cmdResetUSB()
	case "renew-cert":
		err = cmdRenewCert()
	case "version", "--version", "-v":
		fmt.Printf("sem-agent %s %s/%s\n", version, runtime.GOOS, runtime.GOARCH)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", cmd)
		printUsage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintf(os.Stderr, usage, version, runtime.GOOS, runtime.GOARCH, platform.ConfigPath(), platform.LogDir())
}

func requireAdmin(what string) error {
	if platform.IsAdmin() || os.Getenv(platform.EnvDataDir) != "" {
		return nil
	}
	if runtime.GOOS == "windows" {
		return fmt.Errorf("%s requires an elevated (Administrator) prompt", what)
	}
	return fmt.Errorf("%s must be run as root (sudo)", what)
}

func cmdEnroll(args []string) error {
	fs := flag.NewFlagSet("enroll", flag.ContinueOnError)
	server := fs.String("server", "", "server base URL, e.g. https://sem.example.com")
	token := fs.String("token", "", "enrollment token (sem_enr_...)")
	insecure := fs.Bool("insecure-skip-verify", false, "skip TLS certificate verification (testing only)")
	caFile := fs.String("ca-file", "", "PEM CA bundle used to verify the server certificate")
	force := fs.Bool("force", false, "re-enroll even if already enrolled")
	gz := fs.Bool("gzip", false, "gzip-compress large request bodies")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *server == "" || *token == "" {
		return errors.New("--server and --token are required")
	}
	if !strings.HasPrefix(*token, "sem_enr_") {
		return errors.New("--token must be an enrollment token (sem_enr_...)")
	}
	if err := requireAdmin("enroll"); err != nil {
		return err
	}
	if cfg, err := config.Load(""); err == nil && cfg.Enrolled() && !*force {
		return fmt.Errorf("already enrolled as device %s (use --force to re-enroll)", cfg.DeviceID)
	}
	if err := platform.EnsureDataDir(); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	log, closer := logging.Setup(logging.Options{File: true, ToStderr: false})
	defer closer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	srv := config.NormalizeServerURL(*server)
	if !strings.HasPrefix(srv, "https://") && !*insecure {
		fmt.Fprintln(os.Stderr, "warning: server URL is not https; credentials will travel in clear text")
	}

	cfg := &config.Config{ServerURL: srv, InsecureSkipVerify: *insecure, GzipRequests: *gz}
	dir := platform.DataDir()
	if *caFile != "" {
		pem, err := os.ReadFile(*caFile)
		if err != nil {
			return fmt.Errorf("read --ca-file: %w", err)
		}
		cfg.CAFile = filepath.Join(dir, "server-ca.pem")
		if err := platform.WriteFileSecure(cfg.CAFile, pem); err != nil {
			return err
		}
	}

	fmt.Println("Collecting hardware inventory...")
	coll := collector.New(collector.Options{Logger: log})
	hw := coll.Hardware(ctx)
	fmt.Printf("  %s (%s %s), serial %s, %s\n", hw.Hostname, hw.Manufacturer, hw.Model, hw.SerialNumber, hw.OsName)

	keyPEM, csrPEM, err := pki.GenerateKeyAndCSR(hw.SerialNumber)
	if err != nil {
		return fmt.Errorf("generate key: %w", err)
	}
	var cas []string
	if cfg.CAFile != "" {
		cas = append(cas, cfg.CAFile)
	}
	client, err := api.New(api.Options{ServerURL: srv, CAFiles: cas, InsecureSkipVerify: *insecure, Logger: log,
		UserAgent: "sem-agent/" + version + " (" + collector.Platform() + ")"})
	if err != nil {
		return err
	}
	fmt.Printf("Enrolling with %s ...\n", srv)
	resp, err := client.Enroll(ctx, model.EnrollRequest{EnrollmentToken: *token, CsrPem: string(csrPEM), AgentVersion: version, Hardware: hw})
	if err != nil {
		return fmt.Errorf("enrollment failed: %w", err)
	}
	if resp.DeviceID == "" || resp.AgentToken == "" {
		return errors.New("enrollment response is missing deviceId/agentToken")
	}
	cfg.DeviceID, cfg.AgentToken, cfg.Status = resp.DeviceID, resp.AgentToken, resp.Status
	cfg.CheckinIntervalSec, cfg.Policy, cfg.EnrolledAt = resp.CheckinIntervalSec, resp.Policy, model.Now()
	cfg.KeyFile = filepath.Join(dir, "device.key")
	if err := pki.SaveKey(cfg.KeyFile, keyPEM); err != nil {
		return fmt.Errorf("save key: %w", err)
	}
	if resp.CertificatePem != "" {
		cfg.CertFile = filepath.Join(dir, "device.crt")
		if err := pki.SaveCert(cfg.CertFile, []byte(resp.CertificatePem)); err != nil {
			return err
		}
		if _, err := pki.ValidatePair(cfg.CertFile, cfg.KeyFile); err != nil {
			fmt.Fprintln(os.Stderr, "warning: issued certificate does not match the device key:", err)
		}
	}
	if resp.CaCertificatePem != "" {
		cfg.EnrollCAFile = filepath.Join(dir, "ca.pem")
		if err := pki.SaveCert(cfg.EnrollCAFile, []byte(resp.CaCertificatePem)); err != nil {
			return err
		}
	}
	if err := cfg.Save(""); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	log.Info("device enrolled", "deviceId", cfg.DeviceID, "status", cfg.Status, "server", srv)
	fmt.Printf("Enrolled: deviceId=%s status=%s\n", cfg.DeviceID, cfg.Status)
	if strings.EqualFold(cfg.Status, "PENDING") {
		fmt.Println("The device is awaiting approval by an administrator; the agent will keep checking in.")
	}
	fmt.Println("Next: sem-agent install && sem-agent start")
	return nil
}

func cmdRun(args []string) error {
	interactive := service.Interactive()
	log, closer := logging.Setup(logging.Options{File: true, ToStderr: interactive})
	defer closer.Close()
	if interactive {
		// Foreground run: handle Ctrl+C ourselves for a clean shutdown.
		a, err := service.NewAgent(version, log)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, termSignal())
		defer stop()
		return a.Run(ctx)
	}
	s, err := service.New(version, log)
	if err != nil {
		return err
	}
	return s.Run()
}

func cmdControl(action string, args []string) error {
	if err := requireAdmin(action); err != nil {
		return err
	}
	var extIDs []string
	if action == "install" {
		var err error
		if extIDs, err = parseExtensionIDs("install", args); err != nil {
			return err
		}
	}
	if action == "install" {
		if _, err := config.Load(""); err != nil {
			fmt.Fprintln(os.Stderr, "warning:", err)
		}
	}
	if err := service.Control(action); err != nil {
		return fmt.Errorf("%s %s: %w", action, service.Name(), err)
	}
	fmt.Printf("service %s: %s ok\n", service.Name(), action)
	switch action {
	case "install":
		if err := installIntegration(extIDs); err != nil {
			fmt.Fprintln(os.Stderr, "warning: activity helper autostart / browser host not registered:", err)
		}
	case "uninstall":
		_ = activity.RemoveIntegration()
	}
	return nil
}

// parseExtensionIDs reads --extension-id flags (repeatable) and SEM_EXTENSION_IDS.
func parseExtensionIDs(name string, args []string) ([]string, error) {
	var ids []string
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.Func("extension-id", "Chrome/Edge extension ID allowed to talk to the agent (repeatable)", func(v string) error {
		ids = append(ids, v)
		return nil
	})
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if env := os.Getenv("SEM_EXTENSION_IDS"); env != "" {
		ids = append(ids, strings.Split(env, ",")...)
	}
	return ids, nil
}

func installIntegration(extIDs []string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := activity.InstallIntegration(exe, extIDs); err != nil {
		return err
	}
	fmt.Println("activity helper registered to start at user logon; browser native host registered")
	return nil
}

// cmdIntegration registers/removes the per-user helper autostart and the
// browser native messaging host (used by the Linux/macOS installers, which
// manage the system service themselves).
func cmdIntegration(args []string) error {
	if len(args) == 0 || (args[0] != "install" && args[0] != "uninstall") {
		return errors.New("usage: sem-agent integration install [--extension-id ID]... | uninstall")
	}
	if err := requireAdmin("integration"); err != nil {
		return err
	}
	if args[0] == "uninstall" {
		return activity.RemoveIntegration()
	}
	ids, err := parseExtensionIDs("integration install", args[1:])
	if err != nil {
		return err
	}
	return installIntegration(ids)
}

// cmdUserHelper runs the per-user activity helper in the interactive session.
func cmdUserHelper() error {
	logDir := os.TempDir()
	if d, err := os.UserCacheDir(); err == nil {
		logDir = filepath.Join(d, "SecureEndpoint")
	}
	log, closer := logging.Setup(logging.Options{File: true, Dir: logDir})
	defer closer.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, termSignal())
	defer stop()
	log.Info("user helper starting", "user", activity.CurrentUser(), "version", version)
	return activity.NewHelper(log).Run(ctx)
}

func cmdStatus() error {
	st, err := service.Status()
	if err != nil {
		st = "unknown (" + err.Error() + ")"
	}
	fmt.Printf("Agent version : %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
	fmt.Printf("Service       : %s (%s)\n", service.Name(), st)
	fmt.Printf("Config        : %s\n", platform.ConfigPath())
	fmt.Printf("Logs          : %s\n", platform.LogDir())
	cfg, err := config.Load("")
	if err != nil {
		fmt.Printf("Enrollment    : %v\n", err)
		return nil
	}
	fmt.Printf("Server        : %s\n", cfg.ServerURL)
	fmt.Printf("Device ID     : %s (status at enrollment: %s, enrolled %s)\n", cfg.DeviceID, cfg.Status, cfg.EnrolledAt)
	if cfg.CertFile != "" {
		if cn, exp, err := pki.CertInfo(cfg.CertFile); err == nil {
			fmt.Printf("Certificate   : CN=%s, expires %s\n", cn, exp.Format(time.RFC3339))
		}
	}
	if cfg.Policy != nil {
		fmt.Printf("Policy        : %s (v%d) usb.blockStorage=%v software.autoUninstall=%v\n", cfg.Policy.Name, cfg.Policy.Version,
			cfg.Policy.Usb.BlockStorage, cfg.Policy.Software.AutoUninstallBlacklisted)
	}
	sp := api.NewSpool(platform.StatePath("spool.jsonl"), 0)
	fmt.Printf("Offline spool : %d queued request(s)\n", sp.Len())
	client, err := service.NewClient(cfg, version, logging.Discard())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := client.Policy(ctx); err != nil {
		fmt.Printf("Connectivity  : FAILED (%v)\n", err)
	} else {
		fmt.Printf("Connectivity  : OK\n")
	}
	return nil
}

func cmdCollect(args []string) error {
	fs := flag.NewFlagSet("collect", flag.ContinueOnError)
	asJSON := fs.Bool("json", true, "print JSON (default)")
	skipPatches := fs.Bool("skip-patches", false, "skip the (slow) patch scan")
	skipSoftware := fs.Bool("skip-software", false, "skip the software inventory")
	section := fs.String("section", "", "print only one section: hardware|security|software|patches|activity")
	verbose := fs.Bool("v", false, "debug logging to stderr")
	if err := fs.Parse(args); err != nil {
		return err
	}
	_ = asJSON
	lvl := "warn"
	if *verbose {
		lvl = "debug"
	}
	log, closer := logging.Setup(logging.Options{ToStderr: true, Level: lvl})
	defer closer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	c := collector.New(collector.Options{SkipPatches: *skipPatches, SkipSoftware: *skipSoftware, Logger: log})
	var out any
	switch *section {
	case "":
		out = c.Report(ctx)
	case "hardware":
		out = c.Hardware(ctx)
	case "security":
		out = c.Security(ctx)
	case "software":
		out = c.Software(ctx)
	case "patches":
		out = c.Patches(ctx, true)
	case "activity":
		out = sampleActivity(ctx, 10)
	default:
		return fmt.Errorf("unknown section %q", *section)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(out)
}

func cmdUSB() error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	devs, err := usb.Enumerate(ctx)
	if err != nil {
		return err
	}
	var pol *model.AgentPolicy
	if cfg, err := config.Load(""); err == nil {
		pol = cfg.Policy
	}
	type row struct {
		usb.Device
		Decision usb.Decision `json:"decision"`
	}
	rows := make([]row, 0, len(devs))
	for _, d := range devs {
		rows = append(rows, row{Device: d, Decision: usb.Evaluate(pol, d, time.Now())})
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(rows)
}

func cmdRenewCert() error {
	if err := requireAdmin("renew-cert"); err != nil {
		return err
	}
	log, closer := logging.Setup(logging.Options{File: true, ToStderr: true})
	defer closer.Close()
	a, err := service.NewAgent(version, log)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	notAfter, err := a.ForceRenewCertificate(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("Device certificate renewed; valid until %s\n", notAfter.Format(time.RFC3339))
	fmt.Println("Run `sem-agent restart` so a running service picks it up immediately.")
	return nil
}

func cmdResetUSB() error {
	if err := requireAdmin("reset-usb"); err != nil {
		return err
	}
	log, closer := logging.Setup(logging.Options{File: true, ToStderr: true})
	defer closer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	w := usb.NewWatcher(log, nil, nil) // nil policy = no restrictions
	if err := w.ApplyNow(ctx); err != nil {
		return err
	}
	fmt.Println("USB restrictions removed")
	return nil
}

// sampleActivity takes n one-second samples of the current session for
// debugging. Window titles are never read or printed.
func sampleActivity(ctx context.Context, n int) any {
	type row struct {
		At      string  `json:"at"`
		App     string  `json:"app"`
		IdleSec float64 `json:"idleSec"`
		Input   bool    `json:"input"`
		Locked  bool    `json:"locked"`
	}
	probe := activity.NewProbe(false)
	var rows []row
	for i := 0; i < n; i++ {
		if s, err := probe.Sample(ctx); err == nil {
			rows = append(rows, row{At: s.At.Format(time.RFC3339), App: s.App, IdleSec: s.Idle.Seconds(), Input: s.Input, Locked: s.Locked})
		}
		if i < n-1 {
			time.Sleep(time.Second)
		}
	}
	return map[string]any{"samples": rows, "note": "input = keyboard/mouse input occurred in that second; key content is never read"}
}
