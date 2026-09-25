// Package software diffs consecutive inventories into INSTALLED / REMOVED
// events, matches inventory against the policy blacklist and uninstalls
// blacklisted software when the policy asks for it.
package software

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/secureendpoint/agent/internal/model"
	"github.com/secureendpoint/agent/internal/platform"
)

// Matcher matches software against blacklist entries (case-insensitive).
type Matcher struct {
	entries []compiled
}

type compiled struct {
	entry     model.BlacklistEntry
	name      string
	publisher string
	re        *regexp.Regexp
}

// NewMatcher compiles the blacklist. Invalid regexes are skipped.
func NewMatcher(entries []model.BlacklistEntry) *Matcher {
	m := &Matcher{}
	for _, e := range entries {
		c := compiled{entry: e, name: strings.ToLower(strings.TrimSpace(e.Name))}
		if e.Publisher != nil {
			c.publisher = strings.ToLower(strings.TrimSpace(*e.Publisher))
		}
		if c.name == "" {
			continue
		}
		if strings.EqualFold(e.MatchType, model.MatchRegex) {
			re, err := regexp.Compile("(?i)" + e.Name)
			if err != nil {
				continue
			}
			c.re = re
		}
		m.entries = append(m.entries, c)
	}
	return m
}

// Match returns the first blacklist entry matching the item.
func (m *Matcher) Match(name, publisher string) (model.BlacklistEntry, bool) {
	ln := strings.ToLower(strings.TrimSpace(name))
	lp := strings.ToLower(strings.TrimSpace(publisher))
	for _, c := range m.entries {
		if c.publisher != "" && !strings.Contains(lp, c.publisher) {
			continue
		}
		switch strings.ToUpper(c.entry.MatchType) {
		case model.MatchExact:
			if ln == c.name {
				return c.entry, true
			}
		case model.MatchRegex:
			if c.re != nil && c.re.MatchString(name) {
				return c.entry, true
			}
		default: // CONTAINS (and unknown types, conservatively)
			if strings.Contains(ln, c.name) {
				return c.entry, true
			}
		}
	}
	return model.BlacklistEntry{}, false
}

// Diff compares two inventories. Names are compared case-insensitively.
// A new version of an existing name is INSTALLED (upgrade); a vanished
// version is REMOVED only when no replacement version appeared.
func Diff(prev, cur []model.Software, now string, user string) []model.SoftwareEvent {
	type vset map[string]model.Software
	group := func(items []model.Software) map[string]vset {
		g := map[string]vset{}
		for _, it := range items {
			k := strings.ToLower(strings.TrimSpace(it.Name))
			if k == "" {
				continue
			}
			if g[k] == nil {
				g[k] = vset{}
			}
			g[k][it.Version] = it
		}
		return g
	}
	pg, cg := group(prev), group(cur)
	var events []model.SoftwareEvent
	ev := func(action string, s model.Software) {
		events = append(events, model.SoftwareEvent{Action: action, Name: s.Name, Version: s.Version, Publisher: s.Publisher, UserName: user, OccurredAt: now})
	}
	for name, cv := range cg {
		pv := pg[name]
		added := 0
		for ver, s := range cv {
			if _, ok := pv[ver]; !ok {
				ev(model.SoftwareInstalled, s)
				added++
			}
		}
		if pv != nil && added == 0 {
			for ver, s := range pv {
				if _, ok := cv[ver]; !ok {
					ev(model.SoftwareRemoved, s)
				}
			}
		}
	}
	for name, pv := range pg {
		if _, ok := cg[name]; ok {
			continue
		}
		for _, s := range pv {
			ev(model.SoftwareRemoved, s)
		}
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].Name != events[j].Name {
			return strings.ToLower(events[i].Name) < strings.ToLower(events[j].Name)
		}
		return events[i].Action < events[j].Action
	})
	return events
}

// Snapshot persists the last inventory for diffing across restarts.
type Snapshot struct {
	path string
	mu   sync.Mutex
}

// NewSnapshot returns a snapshot store (default path in the state dir).
func NewSnapshot(path string) *Snapshot {
	if path == "" {
		path = platform.StatePath("software-snapshot.json")
	}
	return &Snapshot{path: path}
}

type snapItem struct {
	Name      string `json:"n"`
	Version   string `json:"v,omitempty"`
	Publisher string `json:"p,omitempty"`
}

// Load returns the previous inventory (nil, false when none exists).
func (s *Snapshot) Load() ([]model.Software, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return nil, false
	}
	var items []snapItem
	if json.Unmarshal(b, &items) != nil {
		return nil, false
	}
	out := make([]model.Software, len(items))
	for i, it := range items {
		out[i] = model.Software{Name: it.Name, Version: it.Version, Publisher: it.Publisher}
	}
	return out, true
}

// Save stores the inventory.
func (s *Snapshot) Save(items []model.Software) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]snapItem, len(items))
	for i, it := range items {
		out[i] = snapItem{Name: it.Name, Version: it.Version, Publisher: it.Publisher}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return platform.WriteFileSecure(s.path, b)
}

// ErrProtected is returned for OS-critical or agent software.
var ErrProtected = errors.New("refusing to uninstall protected/OS-critical software")

// ErrNoSilentUninstall is returned when no unattended uninstall method exists.
var ErrNoSilentUninstall = errors.New("no silent uninstall method available")

// Find locates an inventory item by exact (case-insensitive) name and
// optional version.
func Find(items []model.Software, name, version string) (model.Software, bool) {
	for _, it := range items {
		if strings.EqualFold(strings.TrimSpace(it.Name), strings.TrimSpace(name)) && (version == "" || it.Version == version) {
			return it, true
		}
	}
	return model.Software{}, false
}

// Uninstall removes an item using the platform's unattended mechanism.
func Uninstall(ctx context.Context, log *slog.Logger, item model.Software) (string, error) {
	if item.Protected {
		return "", ErrProtected
	}
	log.Info("uninstalling software", "name", item.Name, "version", item.Version, "source", item.Source)
	out, err := uninstall(ctx, item)
	if err != nil {
		log.Warn("uninstall failed", "name", item.Name, "err", err.Error())
	} else {
		log.Info("uninstall succeeded", "name", item.Name)
	}
	return out, err
}

// EnforceBlacklist uninstalls blacklisted items (when policy says so) and
// returns BLOCKED events for successfully removed items.
func EnforceBlacklist(ctx context.Context, log *slog.Logger, pol model.SoftwarePolicy, items []model.Software, user string) []model.SoftwareEvent {
	if !pol.AutoUninstallBlacklisted || len(pol.Blacklist) == 0 {
		return nil
	}
	m := NewMatcher(pol.Blacklist)
	var events []model.SoftwareEvent
	for _, it := range items {
		entry, ok := m.Match(it.Name, it.Publisher)
		if !ok {
			continue
		}
		log.Warn("blacklisted software detected", "name", it.Name, "rule", entry.Name, "matchType", entry.MatchType)
		if _, err := Uninstall(ctx, log, it); err != nil {
			continue
		}
		events = append(events, model.SoftwareEvent{Action: model.SoftwareBlocked, Name: it.Name, Version: it.Version,
			Publisher: it.Publisher, UserName: user, OccurredAt: model.Now()})
	}
	return events
}
