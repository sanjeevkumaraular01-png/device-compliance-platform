//go:build windows

package collector

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
)

// withCOM runs fn on a locked OS thread with COM initialised in the given
// apartment, bounded by ctx. COM calls cannot be interrupted, so on timeout
// the worker goroutine is abandoned (it finishes in the background).
func withCOM[T any](ctx context.Context, apartment uint32, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	var zero T
	done := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer func() {
			if r := recover(); r != nil {
				done <- result{zero, fmt.Errorf("COM panic: %v", r)}
			}
		}()
		initialised := true
		if err := ole.CoInitializeEx(0, apartment); err != nil {
			var oe *ole.OleError
			if errors.As(err, &oe) && oe.Code() == 1 { // S_FALSE: already initialised
				initialised = true
			} else if errors.As(err, &oe) && uint32(oe.Code()) == 0x80010106 { // RPC_E_CHANGED_MODE
				initialised = false
			} else {
				done <- result{zero, fmt.Errorf("CoInitializeEx: %w", err)}
				return
			}
		}
		if initialised {
			defer ole.CoUninitialize()
		}
		v, err := fn()
		done <- result{v, err}
	}()
	select {
	case r := <-done:
		return r.v, r.err
	case <-ctx.Done():
		return zero, fmt.Errorf("COM call abandoned: %w", ctx.Err())
	}
}

func createDispatch(progID string) (*ole.IDispatch, error) {
	unk, err := oleutil.CreateObject(progID)
	if err != nil {
		return nil, fmt.Errorf("create %s: %w", progID, err)
	}
	defer unk.Release()
	d, err := unk.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return nil, fmt.Errorf("%s IDispatch: %w", progID, err)
	}
	return d, nil
}

func getDispatch(d *ole.IDispatch, name string, args ...interface{}) (*ole.IDispatch, error) {
	v, err := oleutil.GetProperty(d, name, args...)
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", name, err)
	}
	if v.VT != ole.VT_DISPATCH || v.Val == 0 {
		v.Clear()
		return nil, fmt.Errorf("%s is not an object", name)
	}
	return v.ToIDispatch(), nil // ownership transferred; caller releases
}

func callDispatch(d *ole.IDispatch, name string, args ...interface{}) (*ole.IDispatch, error) {
	v, err := oleutil.CallMethod(d, name, args...)
	if err != nil {
		return nil, fmt.Errorf("call %s: %w", name, err)
	}
	if v.VT != ole.VT_DISPATCH || v.Val == 0 {
		v.Clear()
		return nil, fmt.Errorf("%s returned no object", name)
	}
	return v.ToIDispatch(), nil
}

func getValue(d *ole.IDispatch, name string, args ...interface{}) interface{} {
	v, err := oleutil.GetProperty(d, name, args...)
	if err != nil {
		return nil
	}
	defer v.Clear()
	return v.Value()
}

func getString(d *ole.IDispatch, name string) string {
	if s, ok := getValue(d, name).(string); ok {
		return s
	}
	return ""
}

func getBool(d *ole.IDispatch, name string) bool {
	b, _ := getValue(d, name).(bool)
	return b
}

func toInt(v interface{}) (int64, bool) {
	switch x := v.(type) {
	case int8:
		return int64(x), true
	case int16:
		return int64(x), true
	case int32:
		return int64(x), true
	case int64:
		return x, true
	case int:
		return int64(x), true
	case uint8:
		return int64(x), true
	case uint16:
		return int64(x), true
	case uint32:
		return int64(x), true
	case uint64:
		return int64(x), true
	}
	return 0, false
}

func getInt(d *ole.IDispatch, name string) int64 {
	n, _ := toInt(getValue(d, name))
	return n
}

// stringCollection reads an IStringCollection property.
func stringCollection(d *ole.IDispatch, name string) []string {
	coll, err := getDispatch(d, name)
	if err != nil {
		return nil
	}
	defer coll.Release()
	n := getInt(coll, "Count")
	out := make([]string, 0, n)
	for i := int64(0); i < n; i++ {
		if s, ok := getValue(coll, "Item", int32(i)).(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// ShellBitLockerProtection reads System.Volume.BitLockerProtection for a
// drive root (works without administrator rights). Values: 0 unencryptable,
// 1 on, 2 off, 3 encrypting, 4 decrypting, 5 suspended, 6 on (locked).
func ShellBitLockerProtection(root string) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return withCOM(ctx, ole.COINIT_APARTMENTTHREADED, func() (int, error) {
		shell, err := createDispatch("Shell.Application")
		if err != nil {
			return -1, err
		}
		defer shell.Release()
		folder, err := callDispatch(shell, "NameSpace", root)
		if err != nil {
			return -1, err
		}
		defer folder.Release()
		self, err := getDispatch(folder, "Self")
		if err != nil {
			return -1, err
		}
		defer self.Release()
		v, err := oleutil.CallMethod(self, "ExtendedProperty", "System.Volume.BitLockerProtection")
		if err != nil {
			return -1, err
		}
		defer v.Clear()
		n, ok := toInt(v.Value())
		if !ok {
			return -1, fmt.Errorf("BitLockerProtection unavailable (VT=%d)", v.VT)
		}
		return int(n), nil
	})
}

// WindowsUpdate is one update found by the Windows Update Agent.
type WindowsUpdate struct {
	UpdateID     string
	Title        string
	KBs          []string
	CveIDs       []string
	MsrcSeverity string
	Categories   []string
	Products     []string
	IsDownloaded bool
	ReleasedAt   time.Time
}

// PatchID is "KBnnnnnnn" when the update has a KB article, else the WU update id.
func (u WindowsUpdate) PatchID() string {
	if len(u.KBs) > 0 {
		kb := u.KBs[0]
		if !strings.HasPrefix(strings.ToUpper(kb), "KB") {
			kb = "KB" + kb
		}
		return strings.ToUpper(kb)
	}
	if kb := ExtractKB(u.Title); kb != "" {
		return kb
	}
	return u.UpdateID
}

func newUpdateSession() (*ole.IDispatch, error) {
	s, err := createDispatch("Microsoft.Update.Session")
	if err != nil {
		return nil, err
	}
	_, _ = oleutil.PutProperty(s, "ClientApplicationID", "SecureEndpoint Agent")
	return s, nil
}

func readUpdate(item *ole.IDispatch) WindowsUpdate {
	u := WindowsUpdate{
		Title:        getString(item, "Title"),
		MsrcSeverity: getString(item, "MsrcSeverity"),
		IsDownloaded: getBool(item, "IsDownloaded"),
		KBs:          stringCollection(item, "KBArticleIDs"),
		CveIDs:       stringCollection(item, "CveIDs"),
	}
	if t, ok := getValue(item, "LastDeploymentChangeTime").(time.Time); ok {
		u.ReleasedAt = t
	}
	if id, err := getDispatch(item, "Identity"); err == nil {
		u.UpdateID = getString(id, "UpdateID")
		id.Release()
	}
	if cats, err := getDispatch(item, "Categories"); err == nil {
		n := getInt(cats, "Count")
		for i := int64(0); i < n; i++ {
			c, err := getDispatch(cats, "Item", int32(i))
			if err != nil {
				continue
			}
			name := getString(c, "Name")
			typ := getString(c, "Type")
			if typ == "Product" {
				u.Products = append(u.Products, name)
			} else {
				u.Categories = append(u.Categories, name)
			}
			c.Release()
		}
		cats.Release()
	}
	return u
}

// SearchWindowsUpdates runs an IUpdateSearcher query (e.g.
// "IsInstalled=0 and Type='Software' and IsHidden=0").
func SearchWindowsUpdates(ctx context.Context, criteria string) ([]WindowsUpdate, error) {
	return withCOM(ctx, ole.COINIT_MULTITHREADED, func() ([]WindowsUpdate, error) {
		var out []WindowsUpdate
		session, err := newUpdateSession()
		if err != nil {
			return nil, err
		}
		defer session.Release()
		searcher, err := callDispatch(session, "CreateUpdateSearcher")
		if err != nil {
			return nil, err
		}
		defer searcher.Release()
		result, err := callDispatch(searcher, "Search", criteria)
		if err != nil {
			return nil, err
		}
		defer result.Release()
		updates, err := getDispatch(result, "Updates")
		if err != nil {
			return nil, err
		}
		defer updates.Release()
		n := getInt(updates, "Count")
		for i := int64(0); i < n; i++ {
			item, err := getDispatch(updates, "Item", int32(i))
			if err != nil {
				continue
			}
			out = append(out, readUpdate(item))
			item.Release()
		}
		return out, nil
	})
}

// UpdateFilter selects updates to install.
type UpdateFilter struct {
	PatchIDs   []string // KB ids or update ids; empty = all
	Severities []string // PatchSeverity values; empty = all
}

func (f UpdateFilter) match(u WindowsUpdate) bool {
	if len(f.PatchIDs) > 0 {
		ok := false
		pid := strings.ToUpper(u.PatchID())
		for _, id := range f.PatchIDs {
			id = strings.ToUpper(strings.TrimSpace(id))
			if id == pid || strings.EqualFold(id, u.UpdateID) || (!strings.HasPrefix(id, "KB") && "KB"+id == pid) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if len(f.Severities) > 0 {
		sev := MapMsrcSeverity(u.MsrcSeverity)
		ok := false
		for _, s := range f.Severities {
			if strings.EqualFold(s, sev) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// InstallResult summarises an installation run.
type InstallResult struct {
	Installed      []string `json:"installed"`
	Failed         []string `json:"failed"`
	RebootRequired bool     `json:"rebootRequired"`
	ResultCode     int64    `json:"resultCode"`
}

// InstallWindowsUpdates searches, downloads and installs matching updates
// through the Windows Update Agent (requires SYSTEM / administrator).
func InstallWindowsUpdates(ctx context.Context, f UpdateFilter) (*InstallResult, error) {
	return withCOM(ctx, ole.COINIT_MULTITHREADED, func() (*InstallResult, error) {
		res := &InstallResult{}
		session, err := newUpdateSession()
		if err != nil {
			return res, err
		}
		defer session.Release()
		searcher, err := callDispatch(session, "CreateUpdateSearcher")
		if err != nil {
			return res, err
		}
		defer searcher.Release()
		result, err := callDispatch(searcher, "Search", "IsInstalled=0 and Type='Software' and IsHidden=0")
		if err != nil {
			return res, err
		}
		defer result.Release()
		updates, err := getDispatch(result, "Updates")
		if err != nil {
			return res, err
		}
		defer updates.Release()
		coll, err := createDispatch("Microsoft.Update.UpdateColl")
		if err != nil {
			return res, err
		}
		defer coll.Release()
		var selected []string
		n := getInt(updates, "Count")
		for i := int64(0); i < n; i++ {
			item, err := getDispatch(updates, "Item", int32(i))
			if err != nil {
				continue
			}
			u := readUpdate(item)
			if f.match(u) {
				if !getBool(item, "EulaAccepted") {
					_, _ = oleutil.CallMethod(item, "AcceptEula")
				}
				if _, err := oleutil.CallMethod(coll, "Add", item); err == nil {
					selected = append(selected, u.PatchID())
				}
			}
			item.Release()
		}
		if len(selected) == 0 {
			return res, nil
		}
		downloader, err := callDispatch(session, "CreateUpdateDownloader")
		if err != nil {
			return res, err
		}
		defer downloader.Release()
		if _, err := oleutil.PutProperty(downloader, "Updates", coll); err != nil {
			return res, fmt.Errorf("set downloader updates: %w", err)
		}
		if dl, err := oleutil.CallMethod(downloader, "Download"); err != nil {
			return res, fmt.Errorf("download: %w", err)
		} else {
			dl.Clear()
		}
		installer, err := callDispatch(session, "CreateUpdateInstaller")
		if err != nil {
			return res, err
		}
		defer installer.Release()
		if _, err := oleutil.PutProperty(installer, "Updates", coll); err != nil {
			return res, fmt.Errorf("set installer updates: %w", err)
		}
		ir, err := callDispatch(installer, "Install")
		if err != nil {
			return res, fmt.Errorf("install: %w", err)
		}
		defer ir.Release()
		res.ResultCode = getInt(ir, "ResultCode")
		res.RebootRequired = getBool(ir, "RebootRequired")
		for i, id := range selected {
			ur, err := callDispatch(ir, "GetUpdateResult", int32(i))
			if err != nil {
				continue
			}
			code := getInt(ur, "ResultCode")
			ur.Release()
			if code == 2 || code == 3 { // orcSucceeded / orcSucceededWithErrors
				res.Installed = append(res.Installed, id)
			} else {
				res.Failed = append(res.Failed, id)
			}
		}
		return res, nil
	})
}
