//go:build darwin

package usb

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// macOS has no user-space kernel-level USB storage block. The agent unmounts
// and ejects non-whitelisted external storage as soon as it appears and keeps
// re-ejecting while it stays attached. Hard blocking requires an MDM
// configuration profile (see packaging/macos/sem-usb-restrictions.mobileconfig).
const (
	pollInterval      = 5 * time.Second
	reenforceEachPoll = true
)

type spItem struct {
	Name         string    `json:"_name"`
	VendorID     string    `json:"vendor_id"`
	ProductID    string    `json:"product_id"`
	Serial       string    `json:"serial_num"`
	Manufacturer string    `json:"manufacturer"`
	Media        []spMedia `json:"Media"`
	Items        []spItem  `json:"_items"`
	// macOS 15 SPUSBHostDataType field names
	HostVendorID  string `json:"USBDeviceKeyVendorID"`
	HostProductID string `json:"USBDeviceKeyProductID"`
	HostSerial    string `json:"USBDeviceKeySerialNumber"`
	HostVendor    string `json:"USBDeviceKeyVendorName"`
}

type spMedia struct {
	BsdName string `json:"bsd_name"`
	Volumes []struct {
		BsdName    string `json:"bsd_name"`
		MountPoint string `json:"mount_point"`
	} `json:"volumes"`
}

func enumerate(ctx context.Context) ([]Device, error) {
	out, err := platform.Run(ctx, 20*time.Second, "system_profiler", "SPUSBDataType", "SPUSBHostDataType", "-json")
	if err != nil && out == "" {
		return nil, err
	}
	var doc map[string][]spItem
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return nil, err
	}
	var devs []Device
	var walk func(items []spItem, path string)
	walk = func(items []spItem, path string) {
		for i, it := range items {
			p := path + "/" + it.Name
			vid, pid, serial, mfr := it.VendorID, it.ProductID, it.Serial, it.Manufacturer
			if vid == "" {
				vid, pid, serial, mfr = it.HostVendorID, it.HostProductID, it.HostSerial, it.HostVendor
			}
			if vid != "" && !strings.Contains(strings.ToLower(it.Name), "hub") {
				d := Device{VendorID: NormalizeID(vid), ProductID: NormalizeID(pid), Serial: serial,
					Manufacturer: mfr, Label: it.Name, Class: model.UsbClassOther}
				for _, m := range it.Media {
					if m.BsdName != "" {
						d.Class = model.UsbClassMassStorage
						d.Instance = m.BsdName
						for _, v := range m.Volumes {
							if v.MountPoint != "" && v.BsdName != "" {
								d.Volumes = append(d.Volumes, v.BsdName)
							}
						}
					}
				}
				ln := strings.ToLower(it.Name + " " + mfr)
				if d.Class == model.UsbClassOther {
					switch {
					case strings.Contains(ln, "iphone") || strings.Contains(ln, "ipad") || strings.Contains(ln, "android") || strings.Contains(ln, "phone"):
						d.Class = model.UsbClassPhone
					case strings.Contains(ln, "keyboard") || strings.Contains(ln, "mouse") || strings.Contains(ln, "trackpad"):
						d.Class = model.UsbClassHID
					case strings.Contains(ln, "camera") || strings.Contains(ln, "webcam"):
						d.Class = model.UsbClassVideo
					case strings.Contains(ln, "audio") || strings.Contains(ln, "headset") || strings.Contains(ln, "speaker"):
						d.Class = model.UsbClassAudio
					case strings.Contains(ln, "ethernet") || strings.Contains(ln, "lan"):
						d.Class = model.UsbClassNetwork
					case strings.Contains(ln, "printer"):
						d.Class = model.UsbClassPrinter
					}
				}
				d.Key = p + "#" + strconv.Itoa(i) + "|" + d.VendorID + ":" + d.ProductID + ":" + d.Serial
				devs = append(devs, d)
			}
			walk(it.Items, p)
		}
	}
	for _, items := range doc {
		walk(items, "")
	}
	return devs, nil
}

func applyRules(ctx context.Context, log *slog.Logger, pol *model.AgentPolicy, now time.Time) error {
	marker := platform.StatePath("usb-block.active")
	if pol != nil && pol.Usb.BlockStorage {
		_, err := platform.WriteFileIfChanged(marker, []byte("1"), 0o600)
		return err
	}
	if err := os.Remove(marker); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func enforceDevice(ctx context.Context, log *slog.Logger, d Device, dec Decision) error {
	if d.Class != model.UsbClassMassStorage || d.Instance == "" || !platform.IsAdmin() {
		return nil
	}
	dev := "/dev/" + d.Instance
	if !dec.Allowed {
		if _, err := platform.RunCombined(ctx, 60*time.Second, nil, "diskutil", "unmountDisk", "force", dev); err != nil {
			return err
		}
		_, err := platform.RunCombined(ctx, 60*time.Second, nil, "diskutil", "eject", dev)
		log.Info("usb: ejected blocked storage", "disk", dev, "label", d.Label)
		return err
	}
	if dec.ReadOnly && len(d.Volumes) > 0 {
		if _, err := platform.RunCombined(ctx, 60*time.Second, nil, "diskutil", "unmountDisk", dev); err != nil {
			return err
		}
		for _, v := range d.Volumes {
			if _, err := platform.RunCombined(ctx, 60*time.Second, nil, "diskutil", "mount", "readOnly", "/dev/"+v); err != nil {
				log.Warn("usb: read-only remount failed", "volume", v, "err", err.Error())
			}
		}
	}
	return nil
}
