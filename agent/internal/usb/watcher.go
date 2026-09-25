package usb

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// Sink receives batches of USB events.
type Sink func(events []model.UsbEvent)

// Watcher polls the platform for USB devices, emits events and enforces policy.
type Watcher struct {
	log      *slog.Logger
	sink     Sink
	userFn   func() string
	interval time.Duration
	now      func() time.Time

	mu       sync.Mutex
	policy   *model.AgentPolicy
	known    map[string]Device
	started  bool
	refresh  chan struct{}
	userName string
	userAt   time.Time
}

// NewWatcher creates a watcher. userFn returns the logged-in user (cached).
func NewWatcher(log *slog.Logger, sink Sink, userFn func() string) *Watcher {
	if log == nil {
		log = slog.Default()
	}
	return &Watcher{log: log, sink: sink, userFn: userFn, interval: pollInterval, now: time.Now,
		known: map[string]Device{}, refresh: make(chan struct{}, 1)}
}

// SetPolicy updates the policy and triggers a rules refresh.
func (w *Watcher) SetPolicy(p *model.AgentPolicy) {
	w.mu.Lock()
	w.policy = p
	w.mu.Unlock()
	w.Refresh()
}

// Refresh asks the watcher to re-apply rules and re-evaluate connected devices.
func (w *Watcher) Refresh() {
	select {
	case w.refresh <- struct{}{}:
	default:
	}
}

// ApplyNow applies OS-level rules synchronously (used by REFRESH_USB_RULES)
// and re-evaluates connected devices.
func (w *Watcher) ApplyNow(ctx context.Context) error {
	w.mu.Lock()
	pol := w.policy
	w.mu.Unlock()
	err := applyRules(ctx, w.log, pol, w.now())
	devs, eerr := enumerate(ctx)
	if eerr == nil {
		w.reevaluate(ctx, devs, true)
	}
	if err != nil {
		return err
	}
	return eerr
}

func (w *Watcher) user() string {
	if w.userFn == nil {
		return ""
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if time.Since(w.userAt) > 2*time.Minute {
		w.userName, w.userAt = w.userFn(), time.Now()
	}
	return w.userName
}

// Run polls until ctx is cancelled.
func (w *Watcher) Run(ctx context.Context) {
	if err := w.ApplyNow(ctx); err != nil {
		w.log.Warn("usb: applying rules failed", "err", err.Error())
	}
	t := time.NewTicker(w.interval)
	defer t.Stop()
	var expiry *time.Timer
	resetExpiry := func() {
		if expiry != nil {
			expiry.Stop()
		}
		w.mu.Lock()
		var next time.Time
		if w.policy != nil {
			next = NextExpiry(w.policy.Usb.Whitelist, w.now())
		}
		w.mu.Unlock()
		if !next.IsZero() {
			d := time.Until(next) + time.Second
			expiry = time.AfterFunc(d, func() {
				w.log.Info("usb: temporary approval expired, refreshing rules")
				w.Refresh()
			})
		}
	}
	resetExpiry()
	for {
		select {
		case <-ctx.Done():
			if expiry != nil {
				expiry.Stop()
			}
			return
		case <-w.refresh:
			if err := w.ApplyNow(ctx); err != nil {
				w.log.Warn("usb: applying rules failed", "err", err.Error())
			}
			resetExpiry()
		case <-t.C:
			w.poll(ctx)
		}
	}
}

func (w *Watcher) poll(ctx context.Context) {
	devs, err := enumerate(ctx)
	if err != nil {
		w.log.Debug("usb: enumerate failed", "err", err.Error())
		return
	}
	now := w.now()
	w.mu.Lock()
	pol := w.policy
	first := !w.started
	w.started = true
	current := make(map[string]Device, len(devs))
	for _, d := range devs {
		current[d.Key] = d
	}
	var arrived, departed []Device
	for k, d := range current {
		if _, ok := w.known[k]; !ok {
			arrived = append(arrived, d)
		}
	}
	for k, d := range w.known {
		if _, ok := current[k]; !ok {
			departed = append(departed, d)
		}
	}
	w.known = current
	w.mu.Unlock()

	var events []model.UsbEvent
	user := ""
	if len(arrived) > 0 || len(departed) > 0 {
		user = w.user()
	}
	ts := model.FormatTime(now)
	for _, d := range departed {
		events = append(events, w.event(model.UsbDisconnected, d, user, "", ts))
	}
	for _, d := range arrived {
		if !first {
			events = append(events, w.event(model.UsbConnected, d, user, "", ts))
		}
		dec := Evaluate(pol, d, now)
		if !dec.Enforced {
			continue
		}
		if err := enforceDevice(ctx, w.log, d, dec); err != nil {
			w.log.Warn("usb: enforcement failed", "device", d.Label, "vid", d.VendorID, "pid", d.ProductID, "err", err.Error())
		}
		if dec.Allowed {
			if !first {
				events = append(events, w.event(model.UsbAllowed, d, user, dec.Reason, ts))
			}
		} else {
			w.log.Warn("usb: storage device blocked", "device", d.Label, "vid", d.VendorID, "pid", d.ProductID, "serial", d.Serial)
			events = append(events, w.event(model.UsbBlocked, d, user, dec.Reason, ts))
		}
	}
	// Platforms without kernel-level blocking re-enforce while the device stays attached.
	if reenforceEachPoll {
		for _, d := range devs {
			dec := Evaluate(pol, d, now)
			if dec.Enforced && !dec.Allowed && len(d.Volumes) > 0 && !containsKey(arrived, d.Key) {
				_ = enforceDevice(ctx, w.log, d, dec)
			}
		}
	}
	if len(events) > 0 && w.sink != nil {
		w.sink(events)
	}
}

func containsKey(list []Device, key string) bool {
	for _, d := range list {
		if d.Key == key {
			return true
		}
	}
	return false
}

// reevaluate enforces the policy on already-connected devices (after a policy
// change); emits BLOCKED/ALLOWED only when the decision flips.
func (w *Watcher) reevaluate(ctx context.Context, devs []Device, emit bool) {
	w.mu.Lock()
	pol := w.policy
	w.mu.Unlock()
	now := w.now()
	var events []model.UsbEvent
	ts := model.FormatTime(now)
	for _, d := range devs {
		if d.Class != model.UsbClassMassStorage {
			continue
		}
		dec := Evaluate(pol, d, now)
		if err := enforceDevice(ctx, w.log, d, dec); err != nil {
			w.log.Warn("usb: enforcement failed", "device", d.Label, "err", err.Error())
		}
		if !emit || !dec.Enforced {
			continue
		}
		if !dec.Allowed && !d.Disabled {
			events = append(events, w.event(model.UsbBlocked, d, w.user(), dec.Reason, ts))
		} else if dec.Allowed && d.Disabled {
			events = append(events, w.event(model.UsbAllowed, d, w.user(), dec.Reason, ts))
		}
	}
	if len(events) > 0 && w.sink != nil {
		w.sink(events)
	}
}

func (w *Watcher) event(typ string, d Device, user, reason, ts string) model.UsbEvent {
	class := d.Class
	if class == "" {
		class = model.UsbClassOther
	}
	return model.UsbEvent{EventType: typ, DeviceClass: class, VendorID: d.VendorID, ProductID: d.ProductID,
		SerialNumber: d.Serial, Label: d.Label, UserName: user, PolicyReason: reason, OccurredAt: ts}
}

// Enumerate lists currently connected USB devices (for diagnostics).
func Enumerate(ctx context.Context) ([]Device, error) { return enumerate(ctx) }
