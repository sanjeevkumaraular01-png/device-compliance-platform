// Package service contains the agent main loop and the OS service wrapper
// (Windows Service, systemd unit, launchd daemon via kardianos/service).
package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/api"
	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/commands"
	"github.com/secureendpoint/agent/internal/config"
	"github.com/secureendpoint/agent/internal/enforce"
	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
	"github.com/secureendpoint/agent/internal/software"
	"github.com/secureendpoint/agent/internal/usb"
)

const (
	defaultCheckin   = 300 * time.Second
	defaultInventory = time.Hour
	minCheckin       = 30 * time.Second
	minInventory     = 5 * time.Minute
)

// Agent is the long-running agent.
type Agent struct {
	Version string

	log    *slog.Logger
	cfg    *config.Config
	client *api.Client
	spool  *api.Spool
	coll   *collector.Collector
	usbw   *usb.Watcher
	disp   *commands.Dispatcher
	snap   *software.Snapshot
	wf     *workforceHub

	mu           sync.Mutex
	lastSecurity *model.SecurityStatus
	authFailed   bool

	reportNow chan struct{}
	cmdQueue  chan model.AgentCommand
	started   time.Time
	rnd       *rand.Rand
}

// NewClient builds an API client from config.
func NewClient(cfg *config.Config, version string, log *slog.Logger) (*api.Client, error) {
	var cas []string
	if cfg.EnrollCAFile != "" && platform.Exists(cfg.EnrollCAFile) {
		cas = append(cas, cfg.EnrollCAFile)
	}
	if cfg.CAFile != "" {
		cas = append(cas, cfg.CAFile)
	}
	return api.New(api.Options{
		ServerURL: cfg.ServerURL, DeviceID: cfg.DeviceID, Token: cfg.AgentToken,
		CAFiles: cas, CertFile: cfg.CertFile, KeyFile: cfg.KeyFile,
		InsecureSkipVerify: cfg.InsecureSkipVerify, Gzip: cfg.GzipRequests,
		UserAgent: "sem-agent/" + version + " (" + collector.Platform() + ")", Logger: log,
	})
}

// NewAgent loads the config and wires all components.
func NewAgent(version string, log *slog.Logger) (*Agent, error) {
	cfg, err := config.Load("")
	if err != nil {
		return nil, err
	}
	if !cfg.Enrolled() {
		return nil, config.ErrNotEnrolled
	}
	client, err := NewClient(cfg, version, log)
	if err != nil {
		return nil, err
	}
	a := &Agent{
		Version:   version,
		log:       log,
		cfg:       cfg,
		client:    client,
		spool:     api.NewSpool(platform.StatePath("spool.jsonl"), 5000),
		coll:      collector.New(collector.Options{Logger: log}),
		disp:      commands.NewDispatcher(log, platform.StatePath("commands-seen.json")),
		snap:      software.NewSnapshot(""),
		reportNow: make(chan struct{}, 1),
		cmdQueue:  make(chan model.AgentCommand, 64),
		started:   time.Now(),
		rnd:       rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	a.wf = newWorkforceHub(a)
	a.usbw = usb.NewWatcher(log, a.sendUsbEvents, func() string { return collector.LoggedInUser(context.Background()) })
	a.registerHandlers()
	return a, nil
}

func (a *Agent) policy() *model.AgentPolicy {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.Policy
}

func (a *Agent) intervals() (checkin, inventory time.Duration) {
	checkin, inventory = defaultCheckin, defaultInventory
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.CheckinIntervalSec > 0 {
		checkin = time.Duration(a.cfg.CheckinIntervalSec) * time.Second
	}
	if p := a.cfg.Policy; p != nil {
		if p.CheckinIntervalSec > 0 {
			checkin = time.Duration(p.CheckinIntervalSec) * time.Second
		}
		if p.InventoryIntervalSec > 0 {
			inventory = time.Duration(p.InventoryIntervalSec) * time.Second
		}
	}
	if checkin < minCheckin {
		checkin = minCheckin
	}
	if inventory < minInventory {
		inventory = minInventory
	}
	if a.authFailed && checkin < 15*time.Minute {
		checkin = 15 * time.Minute
	}
	return
}

// jitter returns d ± 10%.
func (a *Agent) jitter(d time.Duration) time.Duration {
	span := int64(d) / 5
	if span <= 0 {
		return d
	}
	return d - time.Duration(span/2) + time.Duration(a.rnd.Int63n(span))
}

// Run executes the agent until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) error {
	a.log.Info("agent starting", "version", a.Version, "deviceId", a.cfg.DeviceID, "server", a.cfg.ServerURL, "platform", collector.Platform())
	if pol := a.policy(); pol != nil {
		a.usbw.SetPolicy(pol)
		a.wf.SetPolicy(pol.Workforce)
	}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); a.wf.Serve(ctx) }()
	go func() { defer wg.Done(); a.usbw.Run(ctx) }()
	go func() { defer wg.Done(); a.commandWorker(ctx) }()

	// Initial check-in, then a full report shortly after.
	a.heartbeat(ctx)
	checkin, inventory := a.intervals()
	hb := time.NewTimer(a.jitter(checkin))
	rep := time.NewTimer(time.Duration(5+a.rnd.Intn(25)) * time.Second)
	certCheck := time.NewTimer(time.Duration(60+a.rnd.Intn(120)) * time.Second)
	enforced := false
	defer hb.Stop()
	defer rep.Stop()
	defer certCheck.Stop()
	for {
		select {
		case <-ctx.Done():
			a.log.Info("agent stopping")
			wg.Wait()
			return nil
		case <-hb.C:
			a.heartbeat(ctx)
			checkin, _ = a.intervals()
			hb.Reset(a.jitter(checkin))
		case <-rep.C:
			a.report(ctx)
			if !enforced {
				// First enforcement pass needs the collected security state.
				a.enforce(ctx, a.policy())
				enforced = true
			}
			_, inventory = a.intervals()
			rep.Reset(a.jitter(inventory))
		case <-certCheck.C:
			a.maybeRenewCertificate(ctx)
			certCheck.Reset(a.jitter(certCheckInterval))
		case <-a.reportNow:
			a.report(ctx)
			if !rep.Stop() {
				select {
				case <-rep.C:
				default:
				}
			}
			rep.Reset(a.jitter(inventory))
		}
	}
}

// TriggerReport schedules an immediate full report.
func (a *Agent) TriggerReport() {
	select {
	case a.reportNow <- struct{}{}:
	default:
	}
}

// SyncOnce performs an on-demand sync for the `sem-agent sync` CLI verb: it
// uploads a full inventory report and refreshes the cached policy, without the
// enforcement side effects of the background loop.
func (a *Agent) SyncOnce(ctx context.Context) (*model.ReportResponse, error) {
	resp := a.report(ctx)
	if pol, err := a.client.Policy(ctx); err == nil {
		a.mu.Lock()
		a.cfg.Policy = pol
		_ = a.cfg.Save("")
		a.mu.Unlock()
	}
	if resp == nil {
		return nil, fmt.Errorf("report upload failed (queued to the offline spool if the server was unreachable)")
	}
	return resp, nil
}

func (a *Agent) heartbeat(ctx context.Context) {
	req := model.HeartbeatRequest{AgentVersion: a.Version, UptimeSec: a.uptime(), LoggedInUser: collector.LoggedInUser(ctx)}
	resp, err := a.client.Heartbeat(ctx, req)
	if err != nil {
		if api.IsUnauthorized(err) {
			a.mu.Lock()
			first := !a.authFailed
			a.authFailed = true
			a.mu.Unlock()
			if first {
				a.log.Error("agent token rejected by server (device retired or token revoked); re-enroll with 'sem-agent enroll --force'", "err", err.Error())
			}
			return
		}
		a.log.Warn("heartbeat failed", "err", err.Error())
		return
	}
	a.mu.Lock()
	a.authFailed = false
	a.mu.Unlock()
	if n, err := a.spool.Flush(ctx, a.client); n > 0 || err != nil {
		a.log.Info("spool flushed", "delivered", n, "remaining", a.spool.Len(), "err", errString(err))
	}
	if resp.Policy != nil {
		// Workforce fields (clockedOut, currentTask) change without a policy version bump.
		a.wf.SetPolicy(resp.Policy.Workforce)
		cur := a.policy()
		if cur == nil || cur.Version != resp.Policy.Version || cur.PolicyID != resp.Policy.PolicyID {
			a.log.Info("policy changed", "policyId", resp.Policy.PolicyID, "version", resp.Policy.Version, "name", resp.Policy.Name)
			a.applyPolicy(ctx, resp.Policy)
		}
	}
	for _, c := range resp.Commands {
		select {
		case a.cmdQueue <- c:
		default:
			a.log.Error("command queue full, dropping command", "commandId", c.ID)
		}
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (a *Agent) uptime() int64 {
	a.mu.Lock()
	sec := a.lastSecurity
	a.mu.Unlock()
	if sec != nil && sec.LastBootAt != "" {
		if t, err := time.Parse(time.RFC3339Nano, sec.LastBootAt); err == nil {
			return int64(time.Since(t).Seconds())
		}
	}
	return int64(time.Since(a.started).Seconds())
}

// applyPolicy persists the policy and enforces it.
func (a *Agent) applyPolicy(ctx context.Context, pol *model.AgentPolicy) []enforce.Result {
	a.mu.Lock()
	a.cfg.Policy = pol
	if pol.CheckinIntervalSec > 0 {
		a.cfg.CheckinIntervalSec = pol.CheckinIntervalSec
	}
	err := a.cfg.Save("")
	a.mu.Unlock()
	if err != nil {
		a.log.Warn("could not persist policy", "err", err.Error())
	}
	a.usbw.SetPolicy(pol)
	return a.enforce(ctx, pol)
}

func (a *Agent) enforce(ctx context.Context, pol *model.AgentPolicy) []enforce.Result {
	if pol == nil {
		return nil
	}
	a.mu.Lock()
	sec := a.lastSecurity
	a.mu.Unlock()
	if sec == nil {
		s := a.coll.Security(ctx)
		sec = &s
	}
	return enforce.Apply(ctx, a.log, pol, sec)
}

// report collects and uploads the full state, then diffs software.
func (a *Agent) report(ctx context.Context) *model.ReportResponse {
	start := time.Now()
	r := a.coll.Report(ctx)
	a.mu.Lock()
	a.lastSecurity = &r.Security
	a.mu.Unlock()
	a.log.Info("inventory collected", "software", len(r.Software), "patches", len(r.Patches), "duration", time.Since(start).String())
	resp, err := a.client.Report(ctx, r)
	if err != nil {
		a.log.Warn("report upload failed", "err", err.Error())
	} else {
		a.log.Info("report accepted", "complianceState", resp.ComplianceState, "score", resp.ComplianceScore, "riskLevel", resp.RiskLevel)
	}
	a.processSoftware(ctx, r)
	return resp
}

func (a *Agent) processSoftware(ctx context.Context, r *model.Report) {
	if len(r.Software) == 0 {
		return // collection failed; keep the previous snapshot
	}
	user := r.Hardware.LoggedInUser
	var events []model.SoftwareEvent
	if prev, ok := a.snap.Load(); ok {
		events = software.Diff(prev, r.Software, model.Now(), user)
	}
	if pol := a.policy(); pol != nil {
		blocked := software.EnforceBlacklist(ctx, a.log, pol.Software, r.Software, user)
		events = append(events, blocked...) // removal shows up in the next scheduled report
	}
	if err := a.snap.Save(r.Software); err != nil {
		a.log.Warn("could not save software snapshot", "err", err.Error())
	}
	if len(events) == 0 {
		return
	}
	for i := 0; i < len(events); i += 500 {
		end := i + 500
		if end > len(events) {
			end = len(events)
		}
		if err := a.client.Deliver(ctx, a.spool, api.PathSoftwareEvents, map[string]any{"events": events[i:end]}); err != nil {
			a.log.Warn("software events rejected", "err", err.Error())
		}
	}
	a.log.Info("software changes reported", "events", len(events))
}

func (a *Agent) sendUsbEvents(events []model.UsbEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := a.client.Deliver(ctx, a.spool, api.PathUsbEvents, map[string]any{"events": events}); err != nil {
		a.log.Warn("usb events rejected", "err", err.Error())
	}
}

func (a *Agent) commandWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case cmd := <-a.cmdQueue:
			res, executed := a.disp.Execute(ctx, cmd)
			if !executed {
				continue
			}
			if err := a.client.Deliver(ctx, a.spool, api.CommandResultPath(cmd.ID), res); err != nil {
				a.log.Warn("command result rejected", "commandId", cmd.ID, "err", err.Error())
			}
		}
	}
}

func (a *Agent) registerHandlers() {
	a.disp.Register(model.CmdApplyPolicy, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		pol, err := a.client.Policy(ctx)
		if err != nil {
			return commands.Failed("fetch policy: " + err.Error())
		}
		results := a.applyPolicy(ctx, pol)
		usbErr := a.usbw.ApplyNow(ctx)
		res := model.CommandResult{Status: model.ResultSucceeded,
			Output: fmt.Sprintf("policy %q version %d applied", pol.Name, pol.Version),
			Data:   map[string]any{"version": pol.Version, "results": results}}
		var failed []string
		for _, r := range results {
			if r.Error != "" {
				failed = append(failed, r.Setting+": "+r.Error)
			}
		}
		if usbErr != nil {
			failed = append(failed, "usb: "+usbErr.Error())
		}
		if len(failed) > 0 {
			res.Status = model.ResultFailed
			res.Error = fmt.Sprint(failed)
		}
		a.TriggerReport()
		return res
	})
	a.disp.Register(model.CmdCollectInventory, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		a.coll.InvalidatePatches()
		resp := a.report(ctx)
		if resp == nil {
			return commands.Failed("report upload failed (will retry on schedule)")
		}
		return model.CommandResult{Status: model.ResultSucceeded, Output: "inventory reported",
			Data: map[string]any{"complianceState": resp.ComplianceState, "complianceScore": resp.ComplianceScore}}
	})
	a.disp.Register(model.CmdRefreshUsbRules, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		if pol, err := a.client.Policy(ctx); err == nil {
			a.mu.Lock()
			a.cfg.Policy = pol
			_ = a.cfg.Save("")
			a.mu.Unlock()
			a.usbw.SetPolicy(pol)
		} else {
			a.log.Warn("could not refresh policy for USB rules, using cached", "err", err.Error())
		}
		if err := a.usbw.ApplyNow(ctx); err != nil {
			return commands.Failed(err.Error())
		}
		pol := a.policy()
		n := 0
		if pol != nil {
			n = len(usb.ActiveWhitelist(pol.Usb.Whitelist, time.Now()))
		}
		return model.CommandResult{Status: model.ResultSucceeded, Output: fmt.Sprintf("USB rules applied (%d active whitelist entries)", n)}
	})
	a.disp.Register(model.CmdUninstallSoftware, func(ctx context.Context, c model.AgentCommand) model.CommandResult {
		name := commands.PayloadString(c.Payload, "name", "")
		version := commands.PayloadString(c.Payload, "version", "")
		if name == "" {
			return commands.Failed("payload.name is required")
		}
		item, ok := software.Find(a.coll.Software(ctx), name, version)
		if !ok {
			return commands.Failed(fmt.Sprintf("software %q not installed", name))
		}
		out, err := software.Uninstall(ctx, a.log, item)
		if err != nil {
			if errors.Is(err, software.ErrProtected) {
				return commands.Failed(err.Error())
			}
			return commands.FromOutput(out, err)
		}
		a.TriggerReport()
		return model.CommandResult{Status: model.ResultSucceeded, Output: out, Data: map[string]any{"name": item.Name, "version": item.Version}}
	})
}
