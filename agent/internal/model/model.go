// Package model holds the wire types of the SecureEndpoint agent protocol
// (docs/API.md, "Agent protocol — /agent"). JSON field names and enum values
// must match the backend exactly.
package model

import "time"

// OsPlatform values (Prisma enum OsPlatform).
const (
	PlatformWindows = "WINDOWS"
	PlatformLinux   = "LINUX"
	PlatformMacOS   = "MACOS"
)

// DeviceType values (Prisma enum DeviceType).
const (
	DeviceLaptop      = "LAPTOP"
	DeviceDesktop     = "DESKTOP"
	DeviceServer      = "SERVER"
	DeviceVM          = "VIRTUAL_MACHINE"
	DeviceWorkstation = "WORKSTATION"
	DeviceOther       = "OTHER"
)

// ProtectionState values (Prisma enum ProtectionState).
const (
	StateEnabled      = "ENABLED"
	StateDisabled     = "DISABLED"
	StateNotInstalled = "NOT_INSTALLED"
	StateOutdated     = "OUTDATED"
	StateUnknown      = "UNKNOWN"
)

// PatchCategory values.
const (
	PatchCatOS          = "OS"
	PatchCatSecurity    = "SECURITY"
	PatchCatApplication = "APPLICATION"
	PatchCatDriver      = "DRIVER"
	PatchCatFeature     = "FEATURE"
)

// PatchSeverity values.
const (
	SevCritical    = "CRITICAL"
	SevImportant   = "IMPORTANT"
	SevModerate    = "MODERATE"
	SevLow         = "LOW"
	SevUnspecified = "UNSPECIFIED"
)

// PatchState values.
const (
	PatchInstalled      = "INSTALLED"
	PatchMissing        = "MISSING"
	PatchPendingInstall = "PENDING_INSTALL"
	PatchFailed         = "FAILED"
)

// UsbEventType values.
const (
	UsbConnected    = "CONNECTED"
	UsbDisconnected = "DISCONNECTED"
	UsbBlocked      = "BLOCKED"
	UsbAllowed      = "ALLOWED"
)

// UsbDeviceClass values.
const (
	UsbClassMassStorage = "MASS_STORAGE"
	UsbClassHID         = "HID"
	UsbClassAudio       = "AUDIO"
	UsbClassVideo       = "VIDEO"
	UsbClassPrinter     = "PRINTER"
	UsbClassNetwork     = "NETWORK"
	UsbClassPhone       = "PHONE"
	UsbClassOther       = "OTHER"
)

// MatchType values.
const (
	MatchExact    = "EXACT"
	MatchContains = "CONTAINS"
	MatchRegex    = "REGEX"
)

// CommandType values (Prisma enum CommandType).
const (
	CmdUninstallSoftware = "UNINSTALL_SOFTWARE"
	CmdInstallPatches    = "INSTALL_PATCHES"
	CmdApplyPolicy       = "APPLY_POLICY"
	CmdCollectInventory  = "COLLECT_INVENTORY"
	CmdLockScreen        = "LOCK_SCREEN"
	CmdRestart           = "RESTART"
	CmdEnableEncryption  = "ENABLE_ENCRYPTION"
	CmdRefreshUsbRules   = "REFRESH_USB_RULES"
)

// Software event actions.
const (
	SoftwareInstalled = "INSTALLED"
	SoftwareRemoved   = "REMOVED"
	SoftwareBlocked   = "BLOCKED"
)

// HardwareInfo is sent on enroll and in every report.
type HardwareInfo struct {
	Hostname     string   `json:"hostname"`
	DeviceName   string   `json:"deviceName,omitempty"`
	SerialNumber string   `json:"serialNumber"`
	Manufacturer string   `json:"manufacturer,omitempty"`
	Model        string   `json:"model,omitempty"`
	DeviceType   string   `json:"deviceType,omitempty"`
	Platform     string   `json:"platform"`
	OsName       string   `json:"osName,omitempty"`
	OsVersion    string   `json:"osVersion,omitempty"`
	OsBuild      string   `json:"osBuild,omitempty"`
	CPU          string   `json:"cpu,omitempty"`
	RamMb        int64    `json:"ramMb,omitempty"`
	StorageGb    int64    `json:"storageGb,omitempty"`
	IPAddress    string   `json:"ipAddress,omitempty"`
	MacAddresses []string `json:"macAddresses,omitempty"`
	LoggedInUser string   `json:"loggedInUser,omitempty"`
	Domain       string   `json:"domain,omitempty"`
}

// SecurityStatus is the "security" block of a report.
type SecurityStatus struct {
	AntivirusState        string         `json:"antivirusState"`
	AntivirusProduct      string         `json:"antivirusProduct,omitempty"`
	AntivirusSignatureAt  string         `json:"antivirusSignatureAt,omitempty"`
	EdrState              string         `json:"edrState"`
	EdrProduct            string         `json:"edrProduct,omitempty"`
	FirewallState         string         `json:"firewallState"`
	DiskEncryptionState   string         `json:"diskEncryptionState"`
	EncryptionMethod      string         `json:"encryptionMethod,omitempty"`
	BitlockerState        string         `json:"bitlockerState,omitempty"`
	SecureBootState       string         `json:"secureBootState"`
	TpmPresent            *bool          `json:"tpmPresent,omitempty"`
	ScreenLockEnabled     *bool          `json:"screenLockEnabled,omitempty"`
	ScreenLockTimeoutSec  *int           `json:"screenLockTimeoutSec,omitempty"`
	PasswordOnWake        *bool          `json:"passwordOnWake,omitempty"`
	ScreenSaverEnabled    *bool          `json:"screenSaverEnabled,omitempty"`
	AutoUpdateEnabled     *bool          `json:"autoUpdateEnabled,omitempty"`
	UsbStorageEnabled     *bool          `json:"usbStorageEnabled,omitempty"`
	PendingRebootRequired *bool          `json:"pendingRebootRequired,omitempty"`
	LastBootAt            string         `json:"lastBootAt,omitempty"`
	Raw                   map[string]any `json:"raw,omitempty"`
}

// NewSecurityStatus returns a status with every mandatory state UNKNOWN.
func NewSecurityStatus() SecurityStatus {
	return SecurityStatus{
		AntivirusState:      StateUnknown,
		EdrState:            StateUnknown,
		FirewallState:       StateUnknown,
		DiskEncryptionState: StateUnknown,
		SecureBootState:     StateUnknown,
		Raw:                 map[string]any{},
	}
}

// Software is one installed application / package.
type Software struct {
	Name            string  `json:"name"`
	Version         string  `json:"version,omitempty"`
	Publisher       string  `json:"publisher,omitempty"`
	InstallDate     string  `json:"installDate,omitempty"`
	InstallLocation string  `json:"installLocation,omitempty"`
	SizeMb          float64 `json:"sizeMb,omitempty"`
	Source          string  `json:"source,omitempty"`

	// Agent-local fields (never sent to the server).
	UninstallString      string `json:"-"`
	QuietUninstallString string `json:"-"`
	PackageID            string `json:"-"` // registry key / package name / flatpak app id / bundle path
	Protected            bool   `json:"-"` // OS-critical, never uninstall
}

// Patch is one installed or missing update.
type Patch struct {
	PatchID     string   `json:"patchId"`
	Title       string   `json:"title"`
	Category    string   `json:"category,omitempty"`
	Severity    string   `json:"severity,omitempty"`
	State       string   `json:"state"`
	Product     string   `json:"product,omitempty"`
	CveIDs      []string `json:"cveIds,omitempty"`
	CvssScore   float64  `json:"cvssScore,omitempty"`
	ReleasedAt  string   `json:"releasedAt,omitempty"`
	InstalledAt string   `json:"installedAt,omitempty"`
}

// Report is the body of POST /agent/report.
type Report struct {
	CollectedAt string         `json:"collectedAt"`
	Hardware    HardwareInfo   `json:"hardware"`
	Security    SecurityStatus `json:"security"`
	Software    []Software     `json:"software"`
	Patches     []Patch        `json:"patches"`
}

// ReportResponse is the reply to POST /agent/report.
type ReportResponse struct {
	ComplianceState string           `json:"complianceState"`
	ComplianceScore float64          `json:"complianceScore"`
	RiskLevel       string           `json:"riskLevel"`
	Findings        []map[string]any `json:"findings"`
}

// EnrollRequest is the body of POST /agent/enroll.
type EnrollRequest struct {
	EnrollmentToken string       `json:"enrollmentToken"`
	CsrPem          string       `json:"csrPem,omitempty"`
	AgentVersion    string       `json:"agentVersion"`
	Hardware        HardwareInfo `json:"hardware"`
}

// EnrollResponse is the reply to POST /agent/enroll.
type EnrollResponse struct {
	DeviceID           string       `json:"deviceId"`
	AgentToken         string       `json:"agentToken"`
	Status             string       `json:"status"`
	CertificatePem     string       `json:"certificatePem"`
	CaCertificatePem   string       `json:"caCertificatePem"`
	Policy             *AgentPolicy `json:"policy"`
	CheckinIntervalSec int          `json:"checkinIntervalSec"`
}

// RenewCertificateRequest is the body of POST /agent/certificate/renew.
type RenewCertificateRequest struct {
	CsrPem string `json:"csrPem"`
}

// RenewCertificateResponse is the reply to POST /agent/certificate/renew.
type RenewCertificateResponse struct {
	CertificatePem   string    `json:"certificatePem"`
	CaCertificatePem string    `json:"caCertificatePem"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

// HeartbeatRequest is the body of POST /agent/heartbeat.
type HeartbeatRequest struct {
	AgentVersion string `json:"agentVersion"`
	UptimeSec    int64  `json:"uptimeSec,omitempty"`
	LoggedInUser string `json:"loggedInUser,omitempty"`
}

// HeartbeatResponse is the reply to POST /agent/heartbeat.
type HeartbeatResponse struct {
	Policy        *AgentPolicy   `json:"policy"`
	PolicyVersion int            `json:"policyVersion"`
	Commands      []AgentCommand `json:"commands"`
	ServerTime    string         `json:"serverTime"`
}

// UsbWhitelistEntry is one approved USB device (permanent or temporary).
type UsbWhitelistEntry struct {
	VendorID     string  `json:"vendorId"`
	ProductID    string  `json:"productId"`
	SerialNumber string  `json:"serialNumber"`
	ReadOnly     bool    `json:"readOnly"`
	ExpiresAt    *string `json:"expiresAt"`
}

// UsbPolicy is AgentPolicy.usb.
type UsbPolicy struct {
	BlockStorage     bool                `json:"blockStorage"`
	ReadOnly         bool                `json:"readOnly"`
	AllowWhitelisted bool                `json:"allowWhitelisted"`
	Whitelist        []UsbWhitelistEntry `json:"whitelist"`
}

// BlacklistEntry is one blacklisted software pattern.
type BlacklistEntry struct {
	Name      string  `json:"name"`
	Publisher *string `json:"publisher"`
	MatchType string  `json:"matchType"`
}

// SoftwarePolicy is AgentPolicy.software.
type SoftwarePolicy struct {
	BlockUnauthorized        bool             `json:"blockUnauthorized"`
	AutoUninstallBlacklisted bool             `json:"autoUninstallBlacklisted"`
	Blacklist                []BlacklistEntry `json:"blacklist"`
}

// SecurityPolicy is AgentPolicy.security.
type SecurityPolicy struct {
	RequireAntivirus      bool `json:"requireAntivirus"`
	RequireEdr            bool `json:"requireEdr"`
	RequireFirewall       bool `json:"requireFirewall"`
	RequireDiskEncryption bool `json:"requireDiskEncryption"`
	RequireSecureBoot     bool `json:"requireSecureBoot"`
}

// UpdatesPolicy is AgentPolicy.updates.
type UpdatesPolicy struct {
	AutoUpdateEnabled   bool    `json:"autoUpdateEnabled"`
	AutoPatchDeployment bool    `json:"autoPatchDeployment"`
	PatchDeadlineDays   int     `json:"patchDeadlineDays"`
	MaintenanceWindow   *string `json:"maintenanceWindow"`
}

// ScreenLockPolicy is AgentPolicy.screenLock.
type ScreenLockPolicy struct {
	Enabled         bool `json:"enabled"`
	TimeoutSec      int  `json:"timeoutSec"`
	RequirePassword bool `json:"requirePassword"`
	ScreenSaver     bool `json:"screenSaver"`
}

// AgentPolicy is the effective policy delivered to the agent.
type AgentPolicy struct {
	PolicyID             string           `json:"policyId"`
	Version              int              `json:"version"`
	Name                 string           `json:"name"`
	Usb                  UsbPolicy        `json:"usb"`
	Software             SoftwarePolicy   `json:"software"`
	Security             SecurityPolicy   `json:"security"`
	Updates              UpdatesPolicy    `json:"updates"`
	ScreenLock           ScreenLockPolicy `json:"screenLock"`
	CheckinIntervalSec   int              `json:"checkinIntervalSec"`
	InventoryIntervalSec int              `json:"inventoryIntervalSec"`
}

// AgentCommand is a server-issued command.
type AgentCommand struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Payload   map[string]any `json:"payload"`
	ExpiresAt string         `json:"expiresAt"`
}

// CommandResult is the body of POST /agent/commands/:id/result.
type CommandResult struct {
	Status string         `json:"status"` // SUCCEEDED | FAILED
	Output string         `json:"output,omitempty"`
	Error  string         `json:"error,omitempty"`
	Data   map[string]any `json:"data,omitempty"`
}

// Command result statuses.
const (
	ResultSucceeded = "SUCCEEDED"
	ResultFailed    = "FAILED"
)

// UsbEvent is one entry of POST /agent/usb-events.
type UsbEvent struct {
	EventType    string `json:"eventType"`
	DeviceClass  string `json:"deviceClass"`
	VendorID     string `json:"vendorId,omitempty"`
	ProductID    string `json:"productId,omitempty"`
	SerialNumber string `json:"serialNumber,omitempty"`
	Label        string `json:"label,omitempty"`
	UserName     string `json:"userName,omitempty"`
	FilePath     string `json:"filePath,omitempty"`
	Bytes        int64  `json:"bytes,omitempty"`
	PolicyReason string `json:"policyReason,omitempty"`
	OccurredAt   string `json:"occurredAt"`
}

// SoftwareEvent is one entry of POST /agent/software-events.
type SoftwareEvent struct {
	Action     string `json:"action"`
	Name       string `json:"name"`
	Version    string `json:"version,omitempty"`
	Publisher  string `json:"publisher,omitempty"`
	UserName   string `json:"userName,omitempty"`
	OccurredAt string `json:"occurredAt"`
}

// Now returns the current UTC time formatted as RFC 3339 with milliseconds.
func Now() string { return FormatTime(time.Now()) }

// FormatTime formats t the way the backend expects (ISO-8601, UTC).
func FormatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// Bool returns a pointer to b.
func Bool(b bool) *bool { return &b }

// Int returns a pointer to i.
func Int(i int) *int { return &i }
