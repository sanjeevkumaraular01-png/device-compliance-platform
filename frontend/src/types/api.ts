// SecureEndpoint Manager — API types.
// Mirrors docs/API.md and backend/prisma/schema.prisma. Dates are ISO-8601 strings in JSON.

// ─────────────────────────────── Enums ───────────────────────────────

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "SECURITY_ADMIN",
  "COMPLIANCE_OFFICER",
  "IT_ADMIN",
  "DEPARTMENT_MANAGER",
  "EMPLOYEE",
  "AUDITOR",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const AUTH_PROVIDERS = ["LOCAL", "LDAP", "ACTIVE_DIRECTORY", "AZURE_AD", "OIDC"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const DEVICE_TYPES = ["LAPTOP", "DESKTOP", "SERVER", "VIRTUAL_MACHINE", "WORKSTATION", "OTHER"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const OS_PLATFORMS = ["WINDOWS", "LINUX", "MACOS"] as const;
export type OsPlatform = (typeof OS_PLATFORMS)[number];

export const DEVICE_STATUSES = ["PENDING", "ACTIVE", "INACTIVE", "QUARANTINED", "RETIRED"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const COMPLIANCE_STATES = ["COMPLIANT", "NON_COMPLIANT", "UNKNOWN"] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const RISK_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const WARRANTY_STATUSES = ["ACTIVE", "EXPIRING", "EXPIRED", "UNKNOWN"] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const PROTECTION_STATES = ["ENABLED", "DISABLED", "NOT_INSTALLED", "OUTDATED", "UNKNOWN"] as const;
export type ProtectionState = (typeof PROTECTION_STATES)[number];

export const SOFTWARE_STATUSES = ["APPROVED", "UNAUTHORIZED", "BLACKLISTED", "UNKNOWN"] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];

export const MATCH_TYPES = ["EXACT", "CONTAINS", "REGEX"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const USB_DEVICE_CLASSES = ["MASS_STORAGE", "HID", "AUDIO", "VIDEO", "PRINTER", "NETWORK", "PHONE", "OTHER"] as const;
export type UsbDeviceClass = (typeof USB_DEVICE_CLASSES)[number];

export const USB_EVENT_TYPES = ["CONNECTED", "DISCONNECTED", "BLOCKED", "ALLOWED", "FILE_WRITE", "FILE_READ"] as const;
export type UsbEventType = (typeof USB_EVENT_TYPES)[number];

export const USB_ACCESS_STATUSES = ["PENDING", "APPROVED", "DENIED", "EXPIRED", "REVOKED"] as const;
export type UsbAccessStatus = (typeof USB_ACCESS_STATUSES)[number];

export const WHITELIST_SCOPES = ["GLOBAL", "DEPARTMENT", "USER", "DEVICE"] as const;
export type WhitelistScope = (typeof WHITELIST_SCOPES)[number];

export const PATCH_CATEGORIES = ["OS", "SECURITY", "APPLICATION", "DRIVER", "FEATURE"] as const;
export type PatchCategory = (typeof PATCH_CATEGORIES)[number];

export const PATCH_SEVERITIES = ["CRITICAL", "IMPORTANT", "MODERATE", "LOW", "UNSPECIFIED"] as const;
export type PatchSeverity = (typeof PATCH_SEVERITIES)[number];

export const PATCH_STATES = ["INSTALLED", "MISSING", "PENDING_INSTALL", "FAILED"] as const;
export type PatchState = (typeof PATCH_STATES)[number];

export const ALERT_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_CATEGORIES = ["COMPLIANCE", "USB", "SOFTWARE", "SECURITY", "PATCH", "AUTH", "DEVICE", "SYSTEM"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_CHANNEL_TYPES = ["EMAIL", "SMS", "SLACK", "TEAMS", "WHATSAPP", "WEBHOOK"] as const;
export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number];

export const DELIVERY_STATUSES = ["PENDING", "SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const AUDIT_CATEGORIES = ["USER_ACTION", "DEVICE_CHANGE", "POLICY_CHANGE", "AUTH", "USB", "SOFTWARE", "SECURITY", "SYSTEM"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const ACTOR_TYPES = ["USER", "DEVICE", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const REPORT_TYPES = ["COMPLIANCE", "DEVICE", "SOFTWARE", "SECURITY", "AUDIT", "USB", "PATCH"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ["PDF", "XLSX", "CSV"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const COMMAND_TYPES = [
  "UNINSTALL_SOFTWARE",
  "INSTALL_PATCHES",
  "APPLY_POLICY",
  "COLLECT_INVENTORY",
  "LOCK_SCREEN",
  "RESTART",
  "ENABLE_ENCRYPTION",
  "REFRESH_USB_RULES",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const COMMAND_STATUSES = ["PENDING", "SENT", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

// ─────────────────────────────── Envelopes ───────────────────────────────

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  [filter: string]: string | number | boolean | undefined | null;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path?: string;
  timestamp?: string;
  requestId?: string;
}

// ─────────────────────────────── Auth ───────────────────────────────

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: RoleKey;
  roleName: string;
  permissions: string[];
  departmentId: string | null;
  departmentName: string | null;
  mfaEnabled: boolean;
  authProvider: AuthProvider;
  lastLoginAt: string | null;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: CurrentUser;
}

export type LoginResponse = { mfaRequired: true; mfaToken: string } | ({ mfaRequired: false } & TokenResponse);

export interface SsoProvider {
  id: "azure-ad" | "oidc";
  name: string;
  loginUrl: string;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface UserSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

// ─────────────────────────────── Dashboard ───────────────────────────────

export interface DashboardSummary {
  totalDevices: number;
  compliantDevices: number;
  nonCompliantDevices: number;
  unknownDevices: number;
  complianceRate: number;
  averageScore: number;
  criticalRisks: number;
  highRisks: number;
  usbViolations: { last24h: number; last7d: number };
  softwareViolations: { unauthorized: number; blacklisted: number; devicesAffected: number };
  encryption: { encrypted: number; notEncrypted: number; unknown: number };
  antivirus: { protected: number; unprotected: number; unknown: number };
  patches: { upToDate: number; missingCritical: number; missingTotal: number; devicesWithMissing: number };
  onlineDevices: number;
  openAlerts: { total: number; critical: number; high: number };
  byPlatform: { platform: OsPlatform; count: number }[];
  byRisk: { riskLevel: RiskLevel; count: number }[];
}

export interface ComplianceTrendPoint {
  date: string;
  complianceRate: number;
  averageScore: number;
}

export interface TopViolation {
  ruleKey: string;
  name: string;
  severity: RiskLevel;
  deviceCount: number;
}

export interface DepartmentCompliance {
  departmentId: string;
  departmentName: string;
  total: number;
  compliant: number;
  complianceRate: number;
}

// ─────────────────────────────── Devices ───────────────────────────────

export interface UserRef {
  id: string;
  displayName: string;
  email: string;
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface Device {
  id: string;
  deviceName: string;
  hostname: string | null;
  serialNumber: string;
  assetId: string;
  deviceType: DeviceType;
  platform: OsPlatform;
  manufacturer: string | null;
  model: string | null;
  cpu: string | null;
  ramMb: number | null;
  storageGb: number | null;
  osName: string | null;
  osVersion: string | null;
  osBuild: string | null;
  ipAddress: string | null;
  macAddresses: string[];
  assignedUserId: string | null;
  assignedUser: UserRef | null;
  departmentId: string | null;
  department: NamedRef | null;
  policyId: string | null;
  policy: NamedRef | null;
  purchaseDate: string | null;
  warrantyExpiresAt: string | null;
  warrantyStatus: WarrantyStatus;
  status: DeviceStatus;
  isCompanyOwned: boolean;
  complianceState: ComplianceState;
  complianceScore: number;
  riskLevel: RiskLevel;
  lastEvaluatedAt: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  enrolledAt: string | null;
  online: boolean;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDetail extends Device {
  securityStatus: SecurityStatus | null;
  latestCompliance: ComplianceResult | null;
  counts: {
    software: number;
    unauthorizedSoftware: number;
    missingPatches: number;
    usbBlocked7d: number;
    openAlerts: number;
  };
}

export type DeviceWriteInput = Partial<
  Pick<
    Device,
    | "deviceName"
    | "hostname"
    | "serialNumber"
    | "assetId"
    | "deviceType"
    | "platform"
    | "manufacturer"
    | "model"
    | "cpu"
    | "ramMb"
    | "storageGb"
    | "osName"
    | "osVersion"
    | "departmentId"
    | "purchaseDate"
    | "warrantyExpiresAt"
    | "isCompanyOwned"
    | "tags"
    | "notes"
  >
>;

export interface DeviceAssignment {
  id: string;
  deviceId: string;
  userId: string;
  user?: UserRef;
  assignedById: string | null;
  assignedBy?: UserRef | null;
  assignedAt: string;
  unassignedAt: string | null;
  notes: string | null;
}

export interface DeviceCommand {
  id: string;
  deviceId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  result: Record<string, unknown> | null;
  createdById: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export interface SecurityStatus {
  id: string;
  deviceId: string;
  antivirusState: ProtectionState;
  antivirusProduct: string | null;
  antivirusSignatureAt: string | null;
  edrState: ProtectionState;
  edrProduct: string | null;
  firewallState: ProtectionState;
  diskEncryptionState: ProtectionState;
  encryptionMethod: string | null;
  bitlockerState: ProtectionState;
  secureBootState: ProtectionState;
  tpmPresent: boolean | null;
  screenLockEnabled: boolean | null;
  screenLockTimeoutSec: number | null;
  passwordOnWake: boolean | null;
  screenSaverEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  usbStorageEnabled: boolean | null;
  pendingRebootRequired: boolean | null;
  lastBootAt: string | null;
  collectedAt: string;
  updatedAt: string;
}

export interface SecurityDeviceRow extends SecurityStatus {
  device: { id: string; deviceName: string; platform: OsPlatform; assignedUser: UserRef | null };
}

export interface StateCount {
  state: ProtectionState;
  count: number;
}

export interface SecurityOverview {
  antivirus: StateCount[];
  edr: StateCount[];
  firewall: StateCount[];
  diskEncryption: StateCount[];
  secureBoot: StateCount[];
  screenLock: { compliant: number; nonCompliant: number; unknown: number };
}

// ─────────────────────────────── Enrollment ───────────────────────────────

export interface EnrollmentToken {
  id: string;
  name: string;
  tokenPrefix: string;
  platform: OsPlatform | null;
  departmentId: string | null;
  policyId: string | null;
  maxUses: number;
  usedCount: number;
  autoApprove: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface CreatedEnrollmentToken extends EnrollmentToken {
  token: string;
}

export interface CreateEnrollmentTokenInput {
  name: string;
  platform?: OsPlatform;
  departmentId?: string;
  policyId?: string;
  maxUses?: number;
  expiresInDays?: number;
  autoApprove?: boolean;
}

export interface InstallCommand {
  platform: OsPlatform;
  command: string;
  downloadUrl: string;
}

// ─────────────────────────────── Policies ───────────────────────────────

export interface DevicePolicy {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  priority: number;
  version: number;
  companyDataOnlyManaged: boolean;
  usbStorageBlocked: boolean;
  allowWhitelistedUsb: boolean;
  usbReadOnly: boolean;
  blockUnauthorizedSoftware: boolean;
  autoUninstallBlacklisted: boolean;
  requireAntivirus: boolean;
  requireEdr: boolean;
  requireFirewall: boolean;
  requireDiskEncryption: boolean;
  requireSecureBoot: boolean;
  maxAvSignatureAgeDays: number;
  autoUpdateEnabled: boolean;
  autoPatchDeployment: boolean;
  patchDeadlineDays: number;
  maintenanceWindow: string | null;
  screenLockEnabled: boolean;
  screenLockTimeoutSec: number;
  requirePasswordOnWake: boolean;
  screenSaverEnforced: boolean;
  checkinIntervalSec: number;
  inventoryIntervalSec: number;
  extraSettings: Record<string, unknown>;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optional aggregate counts (if the backend includes them). */
  _count?: { devices?: number; departments?: number };
}

export type PolicyInput = Omit<DevicePolicy, "id" | "version" | "createdAt" | "updatedAt" | "createdById" | "_count">;

// ─────────────────────────────── Compliance ───────────────────────────────

export interface ComplianceRule {
  id: string;
  key: string;
  name: string;
  description: string | null;
  severity: RiskLevel;
  weight: number;
  markNonCompliant: boolean;
  enabled: boolean;
  platforms: OsPlatform[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceFinding {
  ruleKey: string;
  name: string;
  severity: RiskLevel;
  passed: boolean;
  markNonCompliant: boolean;
  weight: number;
  detail: string;
  remediation: string;
}

export interface ComplianceResult {
  id: string;
  deviceId: string;
  device?: { id: string; deviceName: string; platform?: OsPlatform; department?: NamedRef | null } | null;
  policyId: string | null;
  policyVersion: number | null;
  score: number;
  state: ComplianceState;
  riskLevel: RiskLevel;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  findings: ComplianceFinding[];
  evaluatedAt: string;
}

export interface ComplianceSummary {
  byRule: { ruleKey: string; name: string; severity: RiskLevel; failing: number }[];
  byState: { state: ComplianceState; count: number }[];
  byRisk: { riskLevel: RiskLevel; count: number }[];
}

// ─────────────────────────────── Software ───────────────────────────────

export interface SoftwareInventory {
  id: string;
  deviceId: string;
  name: string;
  version: string;
  publisher: string | null;
  installDate: string | null;
  installLocation: string | null;
  sizeMb: number | null;
  source: string | null;
  status: SoftwareStatus;
  matchedRuleId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
}

export interface UnauthorizedSoftware extends SoftwareInventory {
  device: { id: string; deviceName: string };
}

export interface SoftwareAggregate {
  name: string;
  publisher: string | null;
  versions: string[];
  installCount: number;
  status: SoftwareStatus;
}

export interface SoftwareWhitelist {
  id: string;
  name: string;
  publisher: string | null;
  matchType: MatchType;
  minVersion: string | null;
  category: string | null;
  platform: OsPlatform | null;
  licenseType: string | null;
  licenseCount: number | null;
  licenseExpiresAt: string | null;
  costPerSeat: string | number | null;
  vendorUrl: string | null;
  notes: string | null;
  approvedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareWhitelistInput {
  name: string;
  publisher?: string | null;
  matchType?: MatchType;
  minVersion?: string | null;
  category?: string | null;
  platform?: OsPlatform | null;
  licenseType?: string | null;
  licenseCount?: number | null;
  licenseKey?: string | null;
  licenseExpiresAt?: string | null;
  costPerSeat?: number | null;
  vendorUrl?: string | null;
  notes?: string | null;
}

export interface SoftwareBlacklist {
  id: string;
  name: string;
  publisher: string | null;
  matchType: MatchType;
  platform: OsPlatform | null;
  reason: string;
  severity: RiskLevel;
  autoUninstall: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SoftwareBlacklistInput = Pick<SoftwareBlacklist, "name" | "reason"> &
  Partial<Pick<SoftwareBlacklist, "publisher" | "matchType" | "platform" | "severity" | "autoUninstall">>;

export interface SoftwareLicense {
  id: string;
  name: string;
  publisher: string | null;
  licenseType: string | null;
  licenseCount: number | null;
  installed: number;
  available: number;
  compliance: "OK" | "OVER" | "EXPIRED";
  licenseExpiresAt: string | null;
  costPerSeat: string | number | null;
}

// ─────────────────────────────── USB ───────────────────────────────

export interface UsbDevice {
  id: string;
  vendorId: string;
  productId: string;
  serialNumber: string;
  manufacturer: string | null;
  productName: string | null;
  deviceClass: UsbDeviceClass;
  isWhitelisted: boolean;
  whitelistScope: WhitelistScope;
  scopeRefId: string | null;
  readOnly: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  notes: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface UsbWhitelistInput {
  vendorId: string;
  productId: string;
  serialNumber?: string;
  productName?: string;
  manufacturer?: string;
  deviceClass: UsbDeviceClass;
  whitelistScope: WhitelistScope;
  scopeRefId?: string;
  readOnly?: boolean;
  notes?: string;
}

export interface UsbEvent {
  id: string;
  deviceId: string;
  device?: { id: string; deviceName: string } | null;
  usbDeviceId: string | null;
  eventType: UsbEventType;
  deviceClass: UsbDeviceClass;
  vendorId: string | null;
  productId: string | null;
  serialNumber: string | null;
  label: string | null;
  userName: string | null;
  filePath: string | null;
  bytes: string | number | null;
  policyReason: string | null;
  occurredAt: string;
  receivedAt: string;
}

export interface UsbAccessRequest {
  id: string;
  deviceId: string;
  device?: { id: string; deviceName: string } | null;
  usbDeviceId: string | null;
  vendorId: string;
  productId: string;
  serialNumber: string;
  requesterId: string;
  requester?: UserRef | null;
  reason: string;
  durationHours: number;
  readOnly: boolean;
  status: UsbAccessStatus;
  approverId: string | null;
  approver?: UserRef | null;
  decisionNote: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface UsbAccessRequestInput {
  deviceId: string;
  vendorId: string;
  productId: string;
  serialNumber?: string;
  reason: string;
  durationHours: number;
  readOnly?: boolean;
}

export interface UsbStats {
  blocked24h: number;
  blocked7d: number;
  allowed7d: number;
  topDevices: { deviceId: string; deviceName: string; blocked: number }[];
  byDay: { date: string; blocked: number; allowed: number }[];
}

// ─────────────────────────────── Patches ───────────────────────────────

export interface PatchStatus {
  id: string;
  deviceId: string;
  patchId: string;
  title: string;
  category: PatchCategory;
  severity: PatchSeverity;
  state: PatchState;
  product: string | null;
  cveIds: string[];
  cvssScore: number | null;
  releasedAt: string | null;
  detectedAt: string;
  installedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface PatchAggregate {
  patchId: string;
  title: string;
  severity: PatchSeverity;
  category: PatchCategory;
  cveIds: string[];
  missingCount: number;
  installedCount: number;
  failedCount: number;
}

export interface PatchSummary {
  bySeverity: { severity: PatchSeverity; missing: number }[];
  devicesFullyPatched: number;
  devicesMissingCritical: number;
  totalMissing: number;
}

export interface Vulnerability {
  cveId: string;
  cvssScore: number | null;
  patchIds: string[];
  affectedDevices: number;
}

export interface PatchDeployInput {
  deviceIds?: string[];
  patchIds?: string[];
  severity?: PatchSeverity[];
}

// ─────────────────────────────── Alerts ───────────────────────────────

export interface AlertDelivery {
  id: string;
  alertId: string;
  channelId: string;
  channel?: { id: string; name: string; type: AlertChannelType } | null;
  status: DeliveryStatus;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface Alert {
  id: string;
  deviceId: string | null;
  device?: { id: string; deviceName: string } | null;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  ruleKey: string | null;
  dedupeKey: string | null;
  occurrences: number;
  metadata: Record<string, unknown>;
  acknowledgedById: string | null;
  acknowledgedAt: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lastOccurredAt: string;
  deliveries?: AlertDelivery[];
}

export type AlertChannelConfig =
  | { recipients: string[] }
  | { provider: "twilio"; to: string[] }
  | { to: string[] }
  | { webhookUrl: string }
  | { url: string; secret?: string };

export interface AlertChannel {
  id: string;
  name: string;
  type: AlertChannelType;
  /** Returned masked by the API (write-only). */
  config: Record<string, unknown> | null;
  minSeverity: AlertSeverity;
  categories: AlertCategory[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannelInput {
  name: string;
  type: AlertChannelType;
  config?: Record<string, unknown>;
  minSeverity: AlertSeverity;
  categories: AlertCategory[];
  enabled: boolean;
}

// ─────────────────────────────── Audit ───────────────────────────────

export interface AuditLog {
  id: string; // BigInt serialized as string
  occurredAt: string;
  category: AuditCategory;
  action: string;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  deviceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  before: unknown;
  after: unknown;
  metadata: unknown;
  prevHash: string | null;
  hash: string;
}

export interface AuditVerifyResult {
  valid: boolean;
  checked: number;
  brokenAt: string | null;
}

export interface LoginHistory {
  id: string;
  userId: string | null;
  email: string;
  provider: AuthProvider;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  mfaUsed: boolean;
  occurredAt: string;
}

// ─────────────────────────────── Reports ───────────────────────────────

export interface ReportParameters {
  from?: string;
  to?: string;
  departmentId?: string;
  platform?: OsPlatform;
  complianceState?: ComplianceState;
}

export interface Report {
  id: string;
  name: string;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  parameters: ReportParameters;
  filePath: string | null;
  fileSize: number | null;
  rowCount: number | null;
  error: string | null;
  requestedById: string | null;
  requestedBy?: UserRef | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateReportInput {
  name?: string;
  type: ReportType;
  format: ReportFormat;
  parameters?: ReportParameters;
}

export interface ReportSchedule {
  id: string;
  name: string;
  type: ReportType;
  format: ReportFormat;
  cron: string;
  parameters: ReportParameters;
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
  createdById: string | null;
  createdAt: string;
}

export type ReportScheduleInput = Pick<ReportSchedule, "name" | "type" | "format" | "cron" | "recipients"> & {
  parameters?: ReportParameters;
  enabled?: boolean;
};

// ─────────────────────────────── Users / Roles / Departments / Settings ───────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  authProvider: AuthProvider;
  roleId: string;
  role?: { id: string; key: RoleKey; name: string } | null;
  departmentId: string | null;
  department?: NamedRef | null;
  jobTitle: string | null;
  phone: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  roleKey: RoleKey;
  departmentId?: string | null;
  password?: string;
  jobTitle?: string | null;
  phone?: string | null;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, "password">> & { isActive?: boolean };

export interface Role {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { users?: number };
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  managerId: string | null;
  manager?: UserRef | null;
  policyId: string | null;
  policy?: NamedRef | null;
  createdAt: string;
  updatedAt: string;
  _count?: { users?: number; devices?: number };
}

export interface DepartmentInput {
  name: string;
  code: string;
  description?: string | null;
  managerId?: string | null;
  policyId?: string | null;
}

export interface IpRestriction {
  id: string;
  cidr: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
}

export type SystemSettings = Record<string, unknown>;
