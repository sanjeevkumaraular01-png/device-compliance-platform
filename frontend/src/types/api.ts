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
  "HR_MANAGER",
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

export const ALERT_CATEGORIES = ["COMPLIANCE", "USB", "SOFTWARE", "SECURITY", "PATCH", "AUTH", "DEVICE", "SYSTEM", "WORKFORCE"] as const;
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
  "SHUTDOWN",
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

export interface AuthMethods {
  local: boolean;
  ldap: boolean;
  sso: SsoProvider[];
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
  osEdition?: string | null;
  osArch?: string | null;
  biosVersion?: string | null;
  gpu?: string | null;
  batteryPercent?: number | null;
  batteryStatus?: string | null;
  ipAddress: string | null;
  macAddresses: string[];
  gateway?: string | null;
  dnsServers?: string[];
  networkAdapters?: NetworkAdapter[] | null;
  assignedUserId: string | null;
  assignedUser: UserRef | null;
  departmentId: string | null;
  department: NamedRef | null;
  policyId: string | null;
  policy: NamedRef | null;
  groupId?: string | null;
  group?: DeviceGroupRef | null;
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

export interface DeviceGroupRef {
  id: string;
  name: string;
  color?: string | null;
}

export interface NetworkAdapter {
  name: string;
  macAddress?: string;
  ipAddresses?: string[];
  gateway?: string;
  dnsSuffix?: string;
  linkSpeed?: string;
}

export interface DeviceService {
  id: string;
  deviceId: string;
  name: string;
  displayName: string | null;
  status: string;
  startType: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { devices?: number };
}

export interface DeviceGroupInput {
  name?: string;
  description?: string | null;
  color?: string | null;
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
  /** Workforce alerts: the employee the alert is about. */
  subjectUserId?: string | null;
  subjectUser?: UserRef | null;
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
  employeeCode?: string | null;
  location?: string | null;
  workProfileId?: string | null;
  workProfile?: { id: string; key: WorkProfileKey; name: string } | null;
  managerId?: string | null;
  manager?: UserRef | null;
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
  employeeCode?: string | null;
  location?: string | null;
  workProfileId?: string | null;
  managerId?: string | null;
}

export type WorkProfileKey = "SALES" | "HR" | "FINANCE" | "DEVELOPER" | "MANAGEMENT" | "SUPPORT" | "CUSTOM";

export interface WorkProfile {
  id: string;
  key: WorkProfileKey;
  name: string;
  description: string | null;
  isSystem: boolean;
  policyId: string | null;
  policy?: { id: string; name: string; version: number } | null;
  requiredSoftware: string[];
  prohibitedSoftware: string[];
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { users?: number };
}

export interface WorkProfileInput {
  key?: WorkProfileKey;
  name?: string;
  description?: string | null;
  policyId?: string | null;
  requiredSoftware?: string[];
  prohibitedSoftware?: string[];
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

// ─────────────────────────────── Self-service enrollment (Deploy) ───────────────────────────────
// docs/DEPLOY-SELF-ENROLL.md — the public /install page and the admin Deployment settings tab.

/** Public config for the /install page (`GET /deploy/config`, anonymous). No secrets. */
export interface DeployConfig {
  enabled: boolean;
  companyName: string;
  identifier?: "employeeCode";
  agentDownloadUrl: string;
}

/** `POST /deploy/session` response — the personalized, single-use deployment credential. */
export interface DeploySession {
  deployToken: string; // sem_enr_… one-time, ~20 min
  expiresAt: string;
  employee: { email: string; displayName: string };
  downloadUrl: string; // MSI (static)
  setupUrl: string; // /deploy/setup.cmd?token=… (personalized one-click)
  serverUrl: string; // API_PUBLIC_URL / DOMAIN
  instructions: string;
}

export const DEPLOY_STATES = ["PENDING_DOWNLOAD", "ENROLLED_PENDING_APPROVAL", "ACTIVE", "EXPIRED"] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];

/** `GET /deploy/status?token=…` — lets the /install page show "installation complete". */
export interface DeployStatus {
  state: DeployState;
  device?: {
    name: string;
    os: string | null;
    lastSeenAt: string | null;
    complianceState: ComplianceState;
  };
}

/** Admin Deployment settings (`GET /deploy/settings`, `settings:write`). */
export interface DeploySettings {
  enabled: boolean;
  companyName: string;
  allowedDomains: string[];
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  installUrl: string; // read-only link to /install
  agentDownloadUrl: string; // read-only MSI link
  configured: boolean; // true once the IMAP host is set
}

/** Body for `PUT /deploy/settings` — only the editable fields. */
export interface DeploySettingsInput {
  enabled: boolean;
  companyName: string;
  allowedDomains: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
}

// ─────────────────────────────── Workforce ───────────────────────────────
// docs/WORKFORCE.md — productivity, attendance, tasks, daily reports, AI work intelligence.

export const ACTIVITY_CATEGORIES = ["PRODUCTIVE", "NEUTRAL", "UNPRODUCTIVE", "BLOCKED", "UNCATEGORIZED"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const APP_RULE_KINDS = ["APP", "WEBSITE"] as const;
export type AppRuleKind = (typeof APP_RULE_KINDS)[number];

export const WORK_LOCATIONS = ["OFFICE", "REMOTE", "UNKNOWN"] as const;
export type WorkLocation = (typeof WORK_LOCATIONS)[number];

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY", "WEEKEND"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const CLOCK_EVENT_TYPES = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END", "LOCK", "UNLOCK", "LOGON", "LOGOFF", "SLEEP", "WAKE"] as const;
export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];
export type ClockAction = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";

export const CLOCK_SOURCES = ["AGENT", "WEB", "MANUAL_CORRECTION"] as const;
export type ClockSource = (typeof CLOCK_SOURCES)[number];

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ["MANUAL", "SALES_CRM", "SUPPORT", "DEVELOPMENT", "MARKETING", "HR", "HARDWARE", "NETWORK", "FINANCE", "OTHER"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TIME_ENTRY_SOURCES = ["TIMER", "AGENT_AUTO", "MANUAL"] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

export const DAILY_REPORT_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "CHANGES_REQUESTED"] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

export const AI_INSIGHT_TYPES = ["EMPLOYEE_DAILY", "MANAGEMENT_DAILY"] as const;
export type AiInsightType = (typeof AI_INSIGHT_TYPES)[number];

export const AI_INSIGHT_STATUSES = ["PENDING", "READY", "FAILED", "SKIPPED"] as const;
export type AiInsightStatus = (typeof AI_INSIGHT_STATUSES)[number];

export const LIVE_STATUSES = ["ONLINE_ACTIVE", "ONLINE_IDLE", "ON_BREAK", "OFFLINE", "CLOCKED_OUT"] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export const WORKFORCE_ALERT_RULES = [
  "late_login",
  "no_activity_after_login",
  "excessive_idle",
  "unproductive_usage",
  "blocked_app_used",
  "no_task_selected",
  "daily_report_missing",
  "excessive_overtime",
  "workload_overload",
  "deadline_at_risk",
  "productivity_drop",
  "repeated_task_delay",
] as const;
export type WorkforceAlertRule = (typeof WORKFORCE_ALERT_RULES)[number];

/** Employee reference as embedded in workforce responses. */
export interface WorkforceUserRef extends UserRef {
  jobTitle?: string | null;
  department?: NamedRef | null;
}

export interface WorkforcePolicy {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  trackingEnabled: boolean;
  timezone: string;
  workDays: number[]; // ISO weekday 1=Mon..7=Sun
  workStart: string; // HH:mm
  workEnd: string;
  graceMinutes: number;
  minDailyMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number;
  maxBreakMinutes: number;
  trackOutsideWorkHours: boolean;
  idleThresholdSec: number;
  trackApps: boolean;
  trackWebsites: boolean;
  captureWindowTitles: boolean;
  screenshotsEnabled: boolean;
  screenshotIntervalMin: number;
  screenshotBlur: boolean;
  screenshotRetentionDays: number;
  officeNetworks: string[];
  requireTaskSelection: boolean;
  requireDailyReport: boolean;
  dailyReportDueTime: string;
  alertLateLogin: boolean;
  alertNoActivityMinutes: number;
  alertIdlePercent: number;
  alertOvertimeMinutes: number;
  alertUnproductivePercent: number;
  employeeCanSeeOwnData: boolean;
  showTrackingNotice: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  departments?: NamedRef[];
  _count?: { departments?: number };
}

export type WorkforcePolicyInput = Omit<WorkforcePolicy, "id" | "version" | "createdAt" | "updatedAt" | "departments" | "_count">;

/** The subset of the policy an employee sees about their own tracking (`GET /workforce/me`). */
export type WorkforcePolicyPublic = Partial<WorkforcePolicy> & Pick<WorkforcePolicy, "timezone" | "workDays" | "workStart" | "workEnd">;

export interface AppRule {
  id: string;
  kind: AppRuleKind;
  pattern: string;
  matchType: MatchType;
  label: string;
  category: ActivityCategory;
  departmentId: string | null;
  department?: NamedRef | null;
  createdAt: string;
  updatedAt: string;
}

export type AppRuleInput = Pick<AppRule, "kind" | "pattern" | "matchType" | "label" | "category"> & { departmentId?: string | null };

export interface UncategorizedItem {
  kind: AppRuleKind;
  value: string;
  seconds: number;
  users: number;
}

export interface WorkSession {
  id: string;
  userId: string;
  date: string;
  status: AttendanceStatus;
  location: WorkLocation;
  clockInAt: string | null;
  clockOutAt: string | null;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  breakSec: number;
  meetingSec: number;
  focusSec: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  missingMinutes: number;
  currentApp: string | null;
  currentTaskId: string | null;
  deviceId: string | null;
  isManuallyAdjusted: boolean;
  adjustmentNote: string | null;
  adjustedById: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRow extends WorkSession {
  user: WorkforceUserRef;
}

export interface AttendanceCorrectionInput {
  clockInAt?: string;
  clockOutAt?: string;
  status?: AttendanceStatus;
  location?: WorkLocation;
  note: string;
}

export interface MonthlyAttendanceDay {
  date: string;
  status: AttendanceStatus | null;
  workedMinutes: number;
  lateMinutes: number;
  location: WorkLocation | null;
}

export interface MonthlyAttendanceTotals {
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
  workedHours: number;
  overtimeHours: number;
  missingHours: number;
}

export interface MonthlyAttendance {
  month: string;
  days: string[];
  rows: { user: WorkforceUserRef; days: MonthlyAttendanceDay[]; totals: MonthlyAttendanceTotals }[];
}

export interface ClockEvent {
  id: string;
  userId: string;
  deviceId: string | null;
  type: ClockEventType;
  source: ClockSource;
  location: WorkLocation;
  ipAddress: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface LiveEmployee {
  userId: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  department: NamedRef | null;
  status: LiveStatus;
  clockInAt: string | null;
  clockOutAt: string | null;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  productivePercent: number;
  currentApp: string | null;
  currentDomain: string | null;
  currentCategory: ActivityCategory | null;
  currentTask: { id: string; title: string; projectName: string | null } | null;
  location: WorkLocation;
  lateMinutes: number;
  deviceName: string | null;
}

export interface WorkforceSummary {
  date: string;
  totalEmployees: number;
  online: number;
  activeNow: number;
  idleNow: number;
  onBreak: number;
  offline: number;
  absent: number;
  late: number;
  onLeave: number;
  remote: number;
  office: number;
  avgActivePercent: number;
  avgProductivePercent: number;
  totalActiveHours: number;
  totalOvertimeHours: number;
  reportsSubmitted: number;
  reportsMissing: number;
  openWorkAlerts: number;
  byDepartment: { departmentId: string; departmentName: string; employees: number; online: number; avgProductivePercent: number; late: number; absent: number }[];
  topApps: { label: string; category: ActivityCategory; seconds: number }[];
}

export interface HourBucket {
  hour: string; // ISO local hour start
  activeSec: number;
  idleSec: number;
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  topApp: string | null;
}

export interface AppUsage {
  label: string;
  app: string | null;
  domain: string | null;
  kind: AppRuleKind;
  category: ActivityCategory;
  seconds: number;
  percent: number;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string | null;
  clientName: string | null;
  departmentId: string | null;
  department?: NamedRef | null;
  ownerId: string | null;
  owner?: UserRef | null;
  status: ProjectStatus;
  budgetHours: number | null;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** Rollup of tracked time on the project's tasks (if the backend includes it). */
  trackedSec?: number;
  _count?: { tasks?: number };
}

export type ProjectInput = Pick<Project, "name" | "code"> &
  Partial<Pick<Project, "description" | "clientName" | "departmentId" | "ownerId" | "budgetHours" | "startDate" | "dueDate" | "status">>;

export interface WorkTask {
  id: string;
  projectId: string | null;
  project: { id: string; name: string; code?: string } | null;
  title: string;
  description: string | null;
  source: TaskSource;
  externalRef: string | null;
  assigneeId: string | null;
  assignee: UserRef | null;
  createdById: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedMinutes: number | null;
  trackedSec: number;
  /** (tracked − estimated) / estimated — as a percentage; null when there is no estimate. */
  variancePercent: number | null;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  delayCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  projectId?: string | null;
  description?: string | null;
  source?: TaskSource;
  externalRef?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  estimatedMinutes?: number | null;
  dueDate?: string | null;
  status?: TaskStatus;
}

export interface TaskImportItem {
  externalRef: string;
  title: string;
  description?: string;
  assigneeEmail?: string;
  projectCode?: string;
  estimatedMinutes?: number;
  dueDate?: string;
  priority?: TaskPriority;
}

export interface TimeEntry {
  id: string;
  userId: string;
  taskId: string;
  task?: { id: string; title: string; project?: { id: string; name: string } | null } | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  source: TimeEntrySource;
  note: string | null;
  createdAt: string;
}

export interface DailyReportItemInput {
  taskId?: string | null;
  projectName?: string | null;
  taskTitle: string;
  workCompleted: string;
  result: string;
  pendingWork?: string | null;
  blocker?: string | null;
  nextAction?: string | null;
  evidenceUrl?: string | null;
  minutesSpent?: number | null;
}

export interface DailyReportItem extends DailyReportItemInput {
  id: string;
  reportId: string;
  sortOrder: number;
  task?: { id: string; title: string; status: TaskStatus } | null;
}

export interface DailyReportAutoDraft {
  generatedAt: string;
  tasks: { taskId: string; taskTitle: string; projectName: string | null; minutes: number }[];
  topApps: { label: string; minutes: number }[];
  activeMinutes: number;
  suggestedItems: DailyReportItemInput[];
}

export interface DailyWorkReport {
  /** null for an unsaved draft returned by `GET /daily-reports/me/:date`. */
  id: string | null;
  userId: string;
  user?: WorkforceUserRef | null;
  date: string;
  status: DailyReportStatus;
  summary: string | null;
  autoDraft: Partial<DailyReportAutoDraft> | null;
  submittedAt: string | null;
  reviewerId: string | null;
  reviewer?: UserRef | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  items: DailyReportItem[];
}

/** Row of `GET /daily-reports` — a real report, or a `missing` pseudo-row for a user without one. */
export type TeamReportRow = Partial<Omit<DailyWorkReport, "user" | "status" | "date" | "id">> & {
  id: string | null;
  user: WorkforceUserRef;
  date: string;
  status: DailyReportStatus | "MISSING";
  missing?: boolean;
};

export interface Screenshot {
  id: string;
  capturedAt: string;
  width: number;
  height: number;
  blurred: boolean;
  activeApp: string | null;
  taskTitle: string | null;
}

export type ReportConsistencyStatus = "CONSISTENT" | "PARTIAL" | "INCONSISTENT" | "NO_REPORT";
export type WorkloadLevel = "UNDER_UTILIZED" | "BALANCED" | "OVERLOADED";

export interface EmployeeInsight {
  summary: string;
  accomplishments: string[];
  blockers: { description: string; evidence: string }[];
  reportConsistency: { status: ReportConsistencyStatus; notes: string[] };
  nonValueWork: { pattern: string; minutes: number; suggestion: string }[];
  workload: WorkloadLevel;
  workloadReason: string;
  processImprovements: string[];
  riskFlags: string[];
  managerNote: string;
}

export interface ManagementInsight {
  headline: string;
  overview: string;
  highlights: string[];
  concerns: string[];
  overloaded: { name: string; reason: string }[];
  underUtilized: { name: string; reason: string }[];
  blockers: { name: string; blocker: string }[];
  reportGaps: string[];
  processImprovements: string[];
  recommendedActions: string[];
}

export interface AiInsight<C = EmployeeInsight | ManagementInsight> {
  id: string;
  type: AiInsightType;
  date: string;
  userId: string | null;
  user?: WorkforceUserRef | null;
  departmentId: string | null;
  department?: NamedRef | null;
  status: AiInsightStatus;
  content: Partial<C> | null;
  model: string | null;
  batchId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AiStatus {
  enabled: boolean;
  model: string | null;
  lastRun: {
    date: string;
    batchId: string | null;
    status: string;
    employees: number;
    succeeded: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  } | null;
}

export interface EmployeeDayTask {
  id: string;
  title: string;
  projectName: string | null;
  trackedSecToday: number;
  estimatedMinutes: number | null;
  status: TaskStatus;
}

export interface EmployeeDay {
  user: WorkforceUserRef;
  session: WorkSession | null;
  timeline: HourBucket[];
  apps: AppUsage[];
  clockEvents: ClockEvent[];
  tasks: EmployeeDayTask[];
  report: DailyWorkReport | null;
  screenshotsCount: number;
  aiInsight: AiInsight<EmployeeInsight> | null;
  alerts: Alert[];
}

export interface WorkforceMe {
  policy: WorkforcePolicyPublic;
  today: WorkSession | null;
  status: LiveStatus;
  runningTimer: TimeEntry | null;
  trackingNotice: string | null;
}

export interface WorkforceAnalyticsRow {
  key: string;
  label: string;
  activePercent: number;
  idlePercent: number;
  productivePercent: number;
  focusHours: number;
  meetingHours: number;
  activeHours: number;
  overtimeHours: number;
  taskCompletionPercent: number;
  tasksCompleted: number;
  tasksTotal: number;
}

export interface WorkforceAnalytics {
  rows: WorkforceAnalyticsRow[];
  trend: { date: string; activePercent: number; productivePercent: number; idlePercent: number }[];
}

export interface HrmsSettings {
  enabled: boolean;
  webhookUrl: string | null;
  /** Write-only: never returned in clear. Some backends return a masked value or `authHeaderSet`. */
  authHeader?: string | null;
  authHeaderSet?: boolean;
  sendDailyAt: string;
}
