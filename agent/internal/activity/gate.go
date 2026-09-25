package activity

import (
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/secureendpoint/agent/internal/model"
)

// ShouldTrack reports whether activity may be collected at now under pol.
// Nothing is collected when tracking is off, after the user clocked out, or
// outside the configured work days/hours (unless trackOutsideWorkHours).
func ShouldTrack(pol *model.WorkforcePolicy, now time.Time) bool {
	if pol == nil || !pol.Enabled || pol.ClockedOut {
		return false
	}
	if pol.TrackOutsideWorkHours {
		return true
	}
	return InWorkHours(pol, now)
}

// InWorkHours evaluates the schedule in the policy's timezone.
func InWorkHours(pol *model.WorkforcePolicy, now time.Time) bool {
	loc := time.UTC
	if pol.Timezone != "" {
		if l, err := time.LoadLocation(pol.Timezone); err == nil {
			loc = l
		}
	}
	local := now.In(loc)
	wd := int(local.Weekday())
	if wd == 0 {
		wd = 7 // ISO: Sunday = 7
	}
	days := pol.WorkDays
	if len(days) == 0 {
		days = []int{1, 2, 3, 4, 5}
	}
	workday := false
	for _, d := range days {
		if d == wd {
			workday = true
			break
		}
	}
	if !workday {
		return false
	}
	start, okS := parseHHMM(pol.WorkStart)
	end, okE := parseHHMM(pol.WorkEnd)
	if !okS || !okE {
		return true // schedule not configured: whole work day
	}
	mins := local.Hour()*60 + local.Minute()
	if end <= start { // overnight shift, e.g. 22:00-06:00
		return mins >= start || mins < end
	}
	return mins >= start && mins < end
}

func parseHHMM(s string) (int, bool) {
	t, err := time.Parse("15:04", strings.TrimSpace(s))
	if err != nil {
		return 0, false
	}
	return t.Hour()*60 + t.Minute(), true
}

// SanitizeDomain reduces a URL or host to a lowercase hostname: scheme,
// credentials, port, path, query and fragment are removed so no page detail
// ever leaves the device. Returns "" for anything that is not a web host.
func SanitizeDomain(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" || strings.ContainsAny(host, " /\\@") {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil {
		return host
	}
	if !strings.Contains(host, ".") && host != "localhost" {
		return ""
	}
	return strings.TrimPrefix(host, "www.")
}
