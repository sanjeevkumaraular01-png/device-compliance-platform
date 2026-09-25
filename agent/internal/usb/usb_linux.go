//go:build linux

package usb

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

const (
	pollInterval      = 2 * time.Second
	reenforceEachPoll = false
	sysUSB            = "/sys/bus/usb/devices"
	// RulesPath is the managed udev rule file.
	RulesPath = "/etc/udev/rules.d/99-sem-usb.rules"
)

func readAttr(dir, name string) string {
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func classFromInterface(code string) string {
	switch strings.ToLower(code) {
	case "08":
		return model.UsbClassMassStorage
	case "03":
		return model.UsbClassHID
	case "01":
		return model.UsbClassAudio
	case "0e":
		return model.UsbClassVideo
	case "07":
		return model.UsbClassPrinter
	case "02", "0a", "e0":
		return model.UsbClassNetwork
	case "06":
		return model.UsbClassPhone // still image / PTP / MTP
	}
	return ""
}

var classPriority = map[string]int{
	model.UsbClassMassStorage: 7, model.UsbClassPhone: 6, model.UsbClassVideo: 5, model.UsbClassAudio: 4,
	model.UsbClassNetwork: 3, model.UsbClassPrinter: 2, model.UsbClassHID: 1,
}

func enumerate(ctx context.Context) ([]Device, error) {
	entries, err := os.ReadDir(sysUSB)
	if err != nil {
		return nil, err
	}
	var out []Device
	for _, e := range entries {
		name := e.Name()
		if strings.Contains(name, ":") || strings.HasPrefix(name, "usb") {
			continue // interfaces and root hubs
		}
		dir := filepath.Join(sysUSB, name)
		vid, pid := readAttr(dir, "idVendor"), readAttr(dir, "idProduct")
		if vid == "" || readAttr(dir, "bDeviceClass") == "09" {
			continue // hubs
		}
		d := Device{
			VendorID: NormalizeID(vid), ProductID: NormalizeID(pid), Serial: readAttr(dir, "serial"),
			Manufacturer: readAttr(dir, "manufacturer"), Instance: name,
		}
		d.Label = strings.TrimSpace(d.Manufacturer + " " + readAttr(dir, "product"))
		best := ""
		ifaces, _ := filepath.Glob(filepath.Join(sysUSB, name+":*"))
		for _, ifc := range ifaces {
			c := classFromInterface(readAttr(ifc, "bInterfaceClass"))
			if classPriority[c] > classPriority[best] {
				best = c
			}
			if c == model.UsbClassMassStorage && readAttr(ifc, "authorized") == "0" {
				d.Disabled = true
			}
		}
		if best == "" {
			best = classFromInterface(readAttr(dir, "bDeviceClass"))
		}
		if best == "" {
			best = model.UsbClassOther
		}
		d.Class = best
		d.Key = name + "|" + d.VendorID + ":" + d.ProductID + ":" + d.Serial
		out = append(out, d)
	}
	return out, nil
}

// applyRules writes (or removes) the udev rule file and reloads udev.
func applyRules(ctx context.Context, log *slog.Logger, pol *model.AgentPolicy, now time.Time) error {
	if !platform.IsAdmin() {
		return errors.New("root privileges required to manage udev rules")
	}
	rules := GenerateUdevRules(pol, now)
	changed := false
	if rules == "" {
		if err := os.Remove(RulesPath); err == nil {
			changed = true
			log.Info("usb: removed udev restrictions", "file", RulesPath)
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	} else {
		var err error
		changed, err = platform.WriteFileIfChanged(RulesPath, []byte(rules), 0o644)
		if err != nil {
			return err
		}
		if changed {
			log.Info("usb: udev rules updated", "file", RulesPath, "blockStorage", pol.Usb.BlockStorage, "readOnly", pol.Usb.ReadOnly)
		}
	}
	if pol != nil && pol.Usb.BlockStorage {
		_, _ = platform.WriteFileIfChanged(platform.StatePath("usb-block.active"), []byte("1"), 0o600)
	} else {
		_ = os.Remove(platform.StatePath("usb-block.active"))
	}
	if !changed || !platform.HasCommand("udevadm") {
		return nil
	}
	if _, err := platform.RunCombined(ctx, 30*time.Second, nil, "udevadm", "control", "--reload-rules"); err != nil {
		return err
	}
	_, err := platform.RunCombined(ctx, 60*time.Second, nil, "udevadm", "trigger", "--subsystem-match=usb", "--action=add")
	return err
}

// enforceDevice (de)authorises the mass-storage interfaces of a device
// immediately (udev handles future plug-ins).
func enforceDevice(ctx context.Context, log *slog.Logger, d Device, dec Decision) error {
	if d.Class != model.UsbClassMassStorage || !platform.IsAdmin() {
		return nil
	}
	want := "1"
	if !dec.Allowed {
		want = "0"
	}
	ifaces, _ := filepath.Glob(filepath.Join(sysUSB, d.Instance+":*"))
	var errs []error
	for _, ifc := range ifaces {
		if readAttr(ifc, "bInterfaceClass") != "08" {
			continue
		}
		if readAttr(ifc, "authorized") == want {
			continue
		}
		if err := os.WriteFile(filepath.Join(ifc, "authorized"), []byte(want), 0o644); err != nil {
			errs = append(errs, err)
			continue
		}
		log.Info("usb: interface authorization changed", "interface", filepath.Base(ifc), "authorized", want)
	}
	if dec.Allowed && dec.ReadOnly {
		// Mark block devices of this USB device read-only.
		blocks, _ := filepath.Glob(filepath.Join(sysUSB, d.Instance+":*", "host*", "target*", "*", "block", "*"))
		for _, b := range blocks {
			_, _ = platform.Run(ctx, 10*time.Second, "blockdev", "--setro", "/dev/"+filepath.Base(b))
		}
	}
	return errors.Join(errs...)
}
