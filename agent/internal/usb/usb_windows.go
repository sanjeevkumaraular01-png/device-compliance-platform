//go:build windows

package usb

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/secureendpoint/agent/internal/collector"
	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// Windows enforcement:
//   - blockStorage without usable whitelist: USBSTOR driver Start=4 (no USB
//     mass-storage device can mount) plus pnputil /disable-device for devices
//     already attached.
//   - blockStorage with whitelist: USBSTOR stays enabled; every non-whitelisted
//     USB storage device is disabled with pnputil /disable-device the moment it
//     appears (Windows 10 2004+), whitelisted ones are (re-)enabled.
//   - readOnly: HKLM\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies WriteProtect=1.
const (
	pollInterval      = 2 * time.Second
	reenforceEachPoll = false

	usbstorKey   = `SYSTEM\CurrentControlSet\Services\USBSTOR`
	writeProtKey = `SYSTEM\CurrentControlSet\Control\StorageDevicePolicies`
)

var usbIDRE = regexp.MustCompile(`(?i)^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(&MI_[0-9A-F]{2})?\\(.+)$`)

type pnpEntity struct {
	DeviceID               string
	Name                   string
	PNPClass               string
	Service                string
	Manufacturer           string
	ConfigManagerErrorCode uint32
}

type diskDrive struct {
	Model       string
	PNPDeviceID string
}

func classFromPnP(pnpClass, service, name string) string {
	s := strings.ToLower(service)
	if s == "usbstor" || s == "uaspstor" {
		return model.UsbClassMassStorage
	}
	switch strings.ToLower(pnpClass) {
	case "diskdrive", "volume", "cdrom":
		return model.UsbClassMassStorage
	case "hidclass", "keyboard", "mouse":
		return model.UsbClassHID
	case "media", "audioendpoint":
		return model.UsbClassAudio
	case "camera", "image":
		return model.UsbClassVideo
	case "printer":
		return model.UsbClassPrinter
	case "net":
		return model.UsbClassNetwork
	case "wpd", "androidusbdevice", "apple mobile device usb driver":
		return model.UsbClassPhone
	}
	ln := strings.ToLower(name)
	if strings.Contains(ln, "apple mobile device") || strings.Contains(ln, "android") || strings.Contains(ln, "mtp") {
		return model.UsbClassPhone
	}
	return ""
}

var classPriority = map[string]int{
	model.UsbClassMassStorage: 7, model.UsbClassPhone: 6, model.UsbClassVideo: 5, model.UsbClassAudio: 4,
	model.UsbClassNetwork: 3, model.UsbClassPrinter: 2, model.UsbClassHID: 1,
}

func enumerate(ctx context.Context) ([]Device, error) {
	ents, err := collector.WMIQuery[pnpEntity](ctx, 20*time.Second, "",
		`SELECT DeviceID, Name, PNPClass, Service, Manufacturer, ConfigManagerErrorCode FROM Win32_PnPEntity WHERE DeviceID LIKE 'USB\\VID%'`)
	if err != nil {
		return nil, err
	}
	type group struct {
		dev   Device
		class string
	}
	parents := map[string]*group{}   // key: VID:PID:instance
	byModel := map[string][]string{} // VID:PID -> parent keys
	var ifaces []pnpEntity
	for _, e := range ents {
		m := usbIDRE.FindStringSubmatch(e.DeviceID)
		if m == nil {
			continue
		}
		if m[3] != "" {
			ifaces = append(ifaces, e)
			continue
		}
		ln := strings.ToLower(e.Name)
		if strings.Contains(ln, "hub") && (strings.EqualFold(e.PNPClass, "USB") || strings.Contains(strings.ToLower(e.Service), "hub")) {
			continue
		}
		vid, pid, inst := strings.ToLower(m[1]), strings.ToLower(m[2]), m[4]
		serial := ""
		if !strings.Contains(inst, "&") {
			serial = inst
		}
		key := vid + ":" + pid + ":" + strings.ToUpper(inst)
		g := &group{dev: Device{Key: key, VendorID: vid, ProductID: pid, Serial: serial, Label: e.Name,
			Manufacturer: e.Manufacturer, Instance: e.DeviceID, Disabled: e.ConfigManagerErrorCode == 22}}
		g.class = classFromPnP(e.PNPClass, e.Service, e.Name)
		parents[key] = g
		byModel[vid+":"+pid] = append(byModel[vid+":"+pid], key)
	}
	for _, e := range ifaces {
		m := usbIDRE.FindStringSubmatch(e.DeviceID)
		c := classFromPnP(e.PNPClass, e.Service, e.Name)
		for _, k := range byModel[strings.ToLower(m[1])+":"+strings.ToLower(m[2])] {
			if classPriority[c] > classPriority[parents[k].class] {
				parents[k].class = c
			}
		}
	}
	// Friendlier labels for storage devices from Win32_DiskDrive.
	disks, _ := collector.WMIQuery[diskDrive](ctx, 20*time.Second, "", `SELECT Model, PNPDeviceID FROM Win32_DiskDrive WHERE InterfaceType='USB'`)
	out := make([]Device, 0, len(parents))
	for _, g := range parents {
		d := g.dev
		d.Class = g.class
		if d.Class == "" {
			d.Class = model.UsbClassOther
		}
		if d.Class == model.UsbClassMassStorage && d.Serial != "" {
			for _, dk := range disks {
				if strings.Contains(strings.ToUpper(dk.PNPDeviceID), strings.ToUpper(d.Serial)) {
					d.Label = dk.Model
				}
			}
		}
		out = append(out, d)
	}
	return out, nil
}

// --- enforcement state ----------------------------------------------------------

type enforceState struct {
	SetUsbstor   bool     `json:"setUsbstor"`   // we changed USBSTOR Start to 4
	PrevStart    uint64   `json:"prevStart"`    // value before we changed it
	SetWriteProt bool     `json:"setWriteProt"` // we set WriteProtect=1
	Disabled     []string `json:"disabled"`     // PnP instances we disabled
}

var stateMu sync.Mutex

func statePath() string { return platform.StatePath("usb-state.json") }

func loadState() enforceState {
	var s enforceState
	if b, err := os.ReadFile(statePath()); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func saveState(s enforceState) {
	if b, err := json.Marshal(s); err == nil {
		_ = platform.WriteFileSecure(statePath(), b)
	}
}

func setDWORD(path, name string, v uint32) (bool, error) {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return false, err
	}
	defer k.Close()
	if cur, _, err := k.GetIntegerValue(name); err == nil && cur == uint64(v) {
		return false, nil
	}
	return true, k.SetDWordValue(name, v)
}

func getDWORD(path, name string) (uint64, bool) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return 0, false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue(name)
	return v, err == nil
}

func applyRules(ctx context.Context, log *slog.Logger, pol *model.AgentPolicy, now time.Time) error {
	if !platform.IsAdmin() {
		return errors.New("administrator rights required to manage USB storage policy")
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	st := loadState()
	var errs []error

	block, readOnly := false, false
	if pol != nil {
		block, readOnly = pol.Usb.BlockStorage, pol.Usb.ReadOnly
	}
	hardBlock := block && !(pol != nil && needsWhitelistMode(pol.Usb, now))

	if hardBlock {
		cur, _ := getDWORD(usbstorKey, "Start")
		if cur != 4 {
			if changed, err := setDWORD(usbstorKey, "Start", 4); err != nil {
				errs = append(errs, err)
			} else if changed {
				st.SetUsbstor, st.PrevStart = true, cur
				log.Info("usb: USBSTOR driver disabled (Start=4)")
			}
		}
	} else if st.SetUsbstor {
		prev := uint32(st.PrevStart)
		if prev == 0 || prev == 4 {
			prev = 3
		}
		if _, err := setDWORD(usbstorKey, "Start", prev); err != nil {
			errs = append(errs, err)
		} else {
			st.SetUsbstor = false
			log.Info("usb: USBSTOR driver re-enabled", "start", prev)
		}
	}

	if readOnly {
		if changed, err := setDWORD(writeProtKey, "WriteProtect", 1); err != nil {
			errs = append(errs, err)
		} else if changed {
			st.SetWriteProt = true
			log.Info("usb: removable storage write protection enabled")
		}
	} else if st.SetWriteProt {
		if _, err := setDWORD(writeProtKey, "WriteProtect", 0); err != nil {
			errs = append(errs, err)
		} else {
			st.SetWriteProt = false
			log.Info("usb: removable storage write protection removed")
		}
	}
	saveState(st)
	return errors.Join(errs...)
}

func pnputil(ctx context.Context, action, instance string) error {
	_, err := platform.RunCombined(ctx, 60*time.Second, nil, "pnputil.exe", action, instance)
	return err
}

func enforceDevice(ctx context.Context, log *slog.Logger, d Device, dec Decision) error {
	if d.Class != model.UsbClassMassStorage || !platform.IsAdmin() {
		return nil
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	st := loadState()
	idx := -1
	for i, id := range st.Disabled {
		if strings.EqualFold(id, d.Instance) {
			idx = i
		}
	}
	if !dec.Allowed {
		if d.Disabled {
			return nil
		}
		if err := pnputil(ctx, "/disable-device", d.Instance); err != nil {
			return err
		}
		if idx < 0 {
			st.Disabled = append(st.Disabled, d.Instance)
			saveState(st)
		}
		log.Info("usb: storage device disabled", "instance", d.Instance, "label", d.Label)
		return nil
	}
	if d.Disabled && idx >= 0 {
		if err := pnputil(ctx, "/enable-device", d.Instance); err != nil {
			return err
		}
		st.Disabled = append(st.Disabled[:idx], st.Disabled[idx+1:]...)
		saveState(st)
		log.Info("usb: storage device re-enabled", "instance", d.Instance, "label", d.Label)
	}
	return nil
}
