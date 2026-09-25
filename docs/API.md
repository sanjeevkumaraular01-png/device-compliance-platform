# SecureEndpoint Manager — REST API Contract (v1)

This document is the **source of truth** shared by the backend (NestJS), the admin
console (Next.js) and the endpoint agent (Go). Field names are camelCase JSON and map
1:1 to the Prisma models in `backend/prisma/schema.prisma`. Enum values are the Prisma
enum values (e.g. `COMPLIANT`, `CRITICAL`, `WINDOWS`).

- Base URL: `/api/v1` (served by NestJS on port `4000`; Nginx proxies `/api/` to it)
- OpenAPI/Swagger UI: `/api/docs` (JSON at `/api/docs-json`)
- Health: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (DB + Redis)
- Metrics: `GET /metrics` (Prometheus, not under `/api/v1`; blocked by Nginx, scraped directly at `backend:4000` / `worker:4000` on the internal network)

## Conventions

**Auth header (console users):** `Authorization: Bearer <accessToken>` (JWT, HS256, 15 min).
**Auth header (agents):** `Authorization: Bearer <agentToken>` + `X-Device-Id: <deviceId>`.

**Pagination** — list endpoints accept `?page=1&pageSize=25&search=&sortBy=createdAt&sortOrder=desc`
plus per-resource filters, and return:

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 25, "total": 312, "totalPages": 13 } }
```

`pageSize` max = 200. Non-list endpoints return the object directly (no envelope).

**Errors** — always:

```json
{ "statusCode": 400, "error": "Bad Request", "message": "serialNumber must be a string", "path": "/api/v1/devices", "timestamp": "2026-09-25T10:00:00.000Z", "requestId": "..." }
```

`message` may be a string or string[] (validation). 401 = not authenticated,
403 = missing permission / IP blocked, 404, 409 = unique conflict, 422 = business rule, 429 = rate limited.

## Roles & permissions

Permissions are strings `resource:action`. Role → permission mapping (seeded, editable by Super Admin):

| Permission | SUPER_ADMIN | SECURITY_ADMIN | COMPLIANCE_OFFICER | IT_ADMIN | DEPARTMENT_MANAGER | EMPLOYEE | AUDITOR |
|---|---|---|---|---|---|---|---|
| `devices:read` | ✔ | ✔ | ✔ | ✔ | ✔ (own dept) | ✔ (own devices) | ✔ |
| `devices:write` | ✔ | ✔ | | ✔ | | | |
| `devices:command` | ✔ | ✔ | | ✔ | | | |
| `enrollment:manage` | ✔ | ✔ | | ✔ | | | |
| `policies:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `policies:write` | ✔ | ✔ | | | | | |
| `software:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `software:write` | ✔ | ✔ | | ✔ | | | |
| `usb:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `usb:write` | ✔ | ✔ | | ✔ | | | |
| `usb:approve` | ✔ | ✔ | | ✔ | ✔ | | |
| `usb:request` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |
| `security:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `patches:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `patches:deploy` | ✔ | ✔ | | ✔ | | | |
| `compliance:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (own) | ✔ |
| `compliance:write` | ✔ | ✔ | ✔ | | | | |
| `alerts:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `alerts:write` | ✔ | ✔ | ✔ | ✔ | | | |
| `alerts:configure` | ✔ | ✔ | | | | | |
| `reports:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `reports:create` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `audit:read` | ✔ | ✔ | ✔ | | | | ✔ |
| `users:read` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ |
| `users:write` | ✔ | | | ✔ | | | |
| `roles:write` | ✔ | | | | | | |
| `settings:write` | ✔ | ✔ | | | | | |
| `dashboard:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Row scoping: DEPARTMENT_MANAGER sees only devices/users/events of their department(s);
EMPLOYEE sees only devices assigned to them. Enforced server-side.

**Workforce module** — role `HR_MANAGER` (Human Resources) and the permissions `workforce:self`,
`workforce:read`, `workforce:manage`, `workforce:screenshots`, `workforce:ai`, `tasks:manage` are
defined in [`docs/WORKFORCE.md`](WORKFORCE.md#roles--permissions-added-to-the-rbac-matrix). HR_MANAGER
additionally holds `users:read`, `reports:read`, `reports:create`, `dashboard:read`, `alerts:read`
(it has none of the device/security permissions above). Every existing role gains `workforce:self`.
Workforce alerts (`category=WORKFORCE`) are visible to DEPARTMENT_MANAGER for employees of their
department(s). The seed grants the new permissions to existing roles once (`seed.workforcePermsVersion`).

---

## Auth — `/auth`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `LoginResponse` |
| POST | `/auth/ldap/login` | `{ username, password }` | `LoginResponse` (LDAP / Active Directory bind) |
| GET | `/auth/sso/providers` | – | `[{ id: "azure-ad" \| "oidc", name, loginUrl }]` (only configured ones) |
| GET | `/auth/methods` | – | `{ local: true, ldap: boolean, sso: SsoProvider[] }` — which sign-in methods are configured; the login page hides the Directory tab when `ldap` is false and shows SSO buttons only for configured providers |
| GET | `/auth/sso/azure-ad/login` | – | 302 to Microsoft identity platform |
| GET | `/auth/sso/azure-ad/callback` | – | 302 to `${WEB_URL}/auth/callback#accessToken=..&refreshToken=..` (or `#mfaToken=..`) |
| GET | `/auth/sso/oidc/login`, `/auth/sso/oidc/callback` | – | generic OIDC, same pattern |
| POST | `/auth/mfa/verify` | `{ mfaToken, code }` (TOTP or recovery code) | `TokenResponse` |
| POST | `/auth/refresh` | `{ refreshToken }` | `TokenResponse` (rotates refresh token) |
| POST | `/auth/logout` | `{ refreshToken }` | `204` |
| GET | `/auth/me` | – | `CurrentUser` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | `204` |
| POST | `/auth/mfa/setup` | – | `{ secret, otpauthUrl, qrCodeDataUrl }` |
| POST | `/auth/mfa/enable` | `{ code }` | `{ recoveryCodes: string[] }` |
| POST | `/auth/mfa/disable` | `{ code }` | `204` |
| GET | `/auth/sessions` | – | `Session[]` (`{ id, ipAddress, userAgent, createdAt, lastSeenAt, expiresAt, current }`) |
| DELETE | `/auth/sessions/:id` | – | `204` |
| DELETE | `/auth/sessions` | – | revoke all other sessions, `204` |

```ts
type LoginResponse =
  | { mfaRequired: true; mfaToken: string }            // 5-minute token, only valid for /auth/mfa/verify
  | ({ mfaRequired: false } & TokenResponse);
type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: CurrentUser };
type CurrentUser = {
  id: string; email: string; displayName: string; role: RoleKey; roleName: string;
  permissions: string[]; departmentId: string | null; departmentName: string | null;
  mfaEnabled: boolean; authProvider: AuthProvider; lastLoginAt: string | null;
};
```

Password policy: ≥ 12 chars, upper, lower, digit, symbol. 5 failed attempts → 15 min lock.
Policy `SECURITY_MFA_REQUIRED_ROLES` (env) forces MFA enrolment for listed roles: login then
returns `{ mfaRequired:false, ..., user.mfaEnabled:false }` plus header `X-MFA-Enrollment-Required: true`
and the console redirects to `/settings/security`.

## Dashboard — `/dashboard`

`GET /dashboard/summary` →

```ts
{
  totalDevices: number; compliantDevices: number; nonCompliantDevices: number; unknownDevices: number;
  complianceRate: number;            // 0-100, 1 decimal: compliant / (compliant + nonCompliant); unknown devices excluded (same basis as compliance-trend and department-compliance)
  averageScore: number;              // 0-100
  criticalRisks: number;             // devices with riskLevel CRITICAL
  highRisks: number;
  usbViolations: { last24h: number; last7d: number };      // BLOCKED usb_events
  softwareViolations: { unauthorized: number; blacklisted: number; devicesAffected: number };
  encryption: { encrypted: number; notEncrypted: number; unknown: number };
  antivirus: { protected: number; unprotected: number; unknown: number };
  patches: { upToDate: number; missingCritical: number; missingTotal: number; devicesWithMissing: number };
  onlineDevices: number;             // lastSeenAt within 15 min
  openAlerts: { total: number; critical: number; high: number };
  byPlatform: { platform: OsPlatform; count: number }[];
  byRisk: { riskLevel: RiskLevel; count: number }[];
}
```

`GET /dashboard/compliance-trend?days=30` → `{ date: "2026-09-01", complianceRate: number, averageScore: number }[]`
`GET /dashboard/top-violations?limit=5` → `{ ruleKey, name, severity, deviceCount }[]`
`GET /dashboard/recent-alerts?limit=10` → `Alert[]`
`GET /dashboard/department-compliance` → `{ departmentId, departmentName, total, compliant, complianceRate }[]`

## Devices — `/devices`

| Method | Path | Notes |
|---|---|---|
| GET | `/devices` | filters: `platform, complianceState, riskLevel, status, departmentId, assignedUserId, deviceType, online=true\|false, warrantyStatus` |
| GET | `/devices/:id` | `DeviceDetail` |
| POST | `/devices` | pre-register asset (status PENDING) |
| PATCH | `/devices/:id` | update inventory fields |
| DELETE | `/devices/:id` | retire (sets `status=RETIRED`, revokes agent token + certs). `?hard=true` for SUPER_ADMIN only |
| POST | `/devices/:id/assign` | `{ userId, notes? }` → closes previous assignment, creates new |
| POST | `/devices/:id/unassign` | |
| GET | `/devices/:id/assignments` | history |
| GET | `/devices/:id/software` | paginated `SoftwareInventory` |
| GET | `/devices/:id/patches` | paginated `PatchStatus`, filter `state, severity` |
| GET | `/devices/:id/usb-events` | paginated |
| GET | `/devices/:id/compliance` | `ComplianceResult[]` (latest 50) |
| GET | `/devices/:id/security` | `SecurityStatus`; `404` until the agent sends its first report |
| GET | `/devices/:id/timeline` | audit entries for device |
| POST | `/devices/:id/commands` | `{ type: CommandType, payload?: object }` → `DeviceCommand` |
| GET | `/devices/:id/commands` | list |
| POST | `/devices/:id/quarantine` / `/devices/:id/release` | |
| POST | `/devices/:id/evaluate` | re-run compliance now → `ComplianceResult` |

```ts
type Device = {
  id, deviceName, hostname, serialNumber, assetId, deviceType, platform, manufacturer, model, cpu,
  ramMb, storageGb, osName, osVersion, osBuild, ipAddress, macAddresses: string[],
  assignedUserId, assignedUser: { id, displayName, email } | null,
  departmentId, department: { id, name } | null, policyId, policy: { id, name } | null,
  purchaseDate, warrantyExpiresAt, warrantyStatus, status, isCompanyOwned,
  complianceState, complianceScore, riskLevel, lastEvaluatedAt,
  agentVersion, lastSeenAt, enrolledAt, online: boolean, tags: string[], notes, createdAt, updatedAt
};
type DeviceDetail = Device & {
  securityStatus: SecurityStatus | null;
  latestCompliance: ComplianceResult | null;
  counts: { software: number; unauthorizedSoftware: number; missingPatches: number; usbBlocked7d: number; openAlerts: number };
};
```

## Enrollment — `/enrollment`

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/enrollment/tokens` | list (never returns raw token) |
| POST | `/enrollment/tokens` | `{ name, platform?, departmentId?, policyId?, maxUses?, expiresInDays?, autoApprove? }` → `{ ...token, token: "sem_enr_..." }` (raw token shown once) |
| DELETE | `/enrollment/tokens/:id` | revoke |
| GET | `/enrollment/install-command?tokenId=&platform=` | `{ platform, command, downloadUrl }` one-liners for PowerShell / bash / zsh |
| GET | `/enrollment/pending` | devices with status PENDING |
| POST | `/enrollment/devices/:id/approve` / `/reject` | device verification |
| GET | `/enrollment/ca.pem` | public CA certificate (no auth) |

## Policies — `/policies`

`GET /policies` (list), `GET /policies/:id`, `POST /policies`, `PATCH /policies/:id` (bumps `version`,
queues `APPLY_POLICY` command for affected devices, re-evaluates compliance), `DELETE /policies/:id`
(not allowed on default), `POST /policies/:id/assign` `{ deviceIds?: string[], departmentIds?: string[] }`,
`GET /policies/:id/devices`, `GET /policies/effective/:deviceId` → effective policy.

Policy resolution: `device.policyId` → `department.policyId` → policy with `isDefault=true`.
Body fields = all `DevicePolicy` columns except ids/timestamps/version.

## Compliance — `/compliance`

| Method | Path | Notes |
|---|---|---|
| GET | `/compliance/rules` | `ComplianceRule[]` |
| PATCH | `/compliance/rules/:id` | `{ severity?, weight?, enabled?, markNonCompliant? }` |
| GET | `/compliance/results` | paginated latest results, filters `state, riskLevel, departmentId` |
| GET | `/compliance/devices/:deviceId/history` | |
| POST | `/compliance/evaluate` | `{ deviceIds?: string[] }` (empty = all) → `{ queued: number }` (BullMQ) |
| GET | `/compliance/summary` | `{ byRule: { ruleKey, name, severity, failing }[], byState: {state,count}[], byRisk: {riskLevel,count}[] }` |

```ts
type ComplianceFinding = { ruleKey: string; name: string; severity: RiskLevel; passed: boolean;
  markNonCompliant: boolean; weight: number; detail: string; remediation: string };
type ComplianceResult = { id, deviceId, policyId, policyVersion, score, state, riskLevel,
  criticalCount, highCount, mediumCount, lowCount, findings: ComplianceFinding[], evaluatedAt };
```

**Built-in rules** (seeded; severity/weight editable):

| ruleKey | Condition (fails when) | Severity | Weight | Non-compliant |
|---|---|---|---|---|
| `USB_STORAGE_ENABLED` | policy.usbStorageBlocked && security.usbStorageEnabled != false | HIGH | 15 | yes |
| `DISK_ENCRYPTION_DISABLED` | policy.requireDiskEncryption && diskEncryptionState != ENABLED | CRITICAL | 25 | yes |
| `ANTIVIRUS_MISSING` | policy.requireAntivirus && antivirusState != ENABLED | CRITICAL | 25 | yes |
| `ANTIVIRUS_OUTDATED` | signatures older than maxAvSignatureAgeDays | MEDIUM | 5 | no |
| `EDR_MISSING` | policy.requireEdr && edrState != ENABLED | HIGH | 15 | yes |
| `FIREWALL_DISABLED` | policy.requireFirewall && firewallState != ENABLED | HIGH | 10 | yes |
| `UNAUTHORIZED_SOFTWARE` | any inventory item with status UNAUTHORIZED or BLACKLISTED | HIGH | 15 | yes |
| `SCREEN_LOCK_DISABLED` | policy.screenLockEnabled && (!screenLockEnabled \|\| timeout > policy timeout \|\| (requirePasswordOnWake && !passwordOnWake)) | MEDIUM | 10 | yes |
| `AUTO_UPDATE_DISABLED` | policy.autoUpdateEnabled && autoUpdateEnabled == false | MEDIUM | 5 | no |
| `CRITICAL_PATCHES_MISSING` | MISSING patch with severity CRITICAL older than patchDeadlineDays | HIGH | 10 | yes |
| `SECURE_BOOT_DISABLED` | policy.requireSecureBoot && secureBootState != ENABLED | MEDIUM | 5 | no |
| `AGENT_OFFLINE` | lastSeenAt older than 7 days | LOW | 5 | no |
| `NOT_COMPANY_DEVICE` | policy.companyDataOnlyManaged && !isCompanyOwned | CRITICAL | 30 | yes |

Score = `max(0, 100 − Σ weight of failed rules)`. State = `NON_COMPLIANT` if any failed rule has
`markNonCompliant`, `UNKNOWN` if no security data received yet, else `COMPLIANT`.
Risk level = highest severity among failed rules (`NONE` if none). On transition to
NON_COMPLIANT or a new CRITICAL finding, an `Alert` (category COMPLIANCE) is raised with
`dedupeKey = compliance:<deviceId>:<ruleKey>`; alerts auto-resolve when the rule passes.

## Software — `/software`

| Method | Path | Notes |
|---|---|---|
| GET | `/software/inventory` | aggregated: `{ name, publisher, versions: string[], installCount, status }[]` paginated, filter `status, platform` |
| GET | `/software/inventory/:name/devices` | devices that have it |
| GET | `/software/unauthorized` | paginated `SoftwareInventory & { device: {id, deviceName} }` with status UNAUTHORIZED/BLACKLISTED |
| GET/POST/PATCH/DELETE | `/software/whitelist[/:id]` | approved catalog (`SoftwareWhitelist`); `licenseKey` write-only |
| GET/POST/PATCH/DELETE | `/software/blacklist[/:id]` | `SoftwareBlacklist` |
| POST | `/software/uninstall` | `{ deviceIds: string[], name: string }` → queues `UNINSTALL_SOFTWARE` → `{ commands: number }` |
| GET | `/software/licenses` | `{ id, name, publisher, licenseType, licenseCount, installed, available, compliance: "OK"\|"OVER"\|"EXPIRED", licenseExpiresAt, costPerSeat }[]` |
| POST | `/software/reclassify` | re-run whitelist/blacklist matching on all inventory → `{ updated }` |

Classification: blacklist match → `BLACKLISTED`; whitelist match → `APPROVED`; otherwise
`UNAUTHORIZED` if the effective policy has `blockUnauthorizedSoftware`, else `UNKNOWN`.
OS-bundled components (publisher Microsoft Corporation/Apple/Canonical + source `system`) are `APPROVED`.

## USB — `/usb`

| Method | Path | Notes |
|---|---|---|
| GET | `/usb/devices` | known USB devices, filter `isWhitelisted, deviceClass` |
| POST | `/usb/devices` | add to whitelist `{ vendorId, productId, serialNumber?, productName?, manufacturer?, deviceClass, whitelistScope, scopeRefId?, readOnly?, notes? }` (sets isWhitelisted=true) |
| PATCH | `/usb/devices/:id` | |
| DELETE | `/usb/devices/:id` | remove from whitelist |
| GET | `/usb/events` | paginated, filters `deviceId, eventType, from, to, vendorId` |
| GET | `/usb/requests` | temporary access requests, filter `status` |
| POST | `/usb/requests` | `{ deviceId, vendorId, productId, serialNumber?, reason, durationHours (1-72), readOnly? }` |
| POST | `/usb/requests/:id/approve` | `{ note?, durationHours? }` → sets expiresAt, queues `REFRESH_USB_RULES` |
| POST | `/usb/requests/:id/deny` | `{ note? }` |
| POST | `/usb/requests/:id/revoke` | |
| GET | `/usb/stats` | `{ blocked24h, blocked7d, allowed7d, topDevices: {deviceId, deviceName, blocked}[], byDay: {date, blocked, allowed}[] }` |

## Security — `/security`

`GET /security/overview` → `{ antivirus: StateCount[], edr: StateCount[], firewall: StateCount[], diskEncryption: StateCount[], secureBoot: StateCount[], screenLock: { compliant, nonCompliant, unknown } }` where `StateCount = { state: ProtectionState, count }`.
`GET /security/devices` → paginated `{ device: {id, deviceName, platform, assignedUser}, ...SecurityStatus }` filters `antivirusState, diskEncryptionState, firewallState, edrState`.

## Patches — `/patches`

`GET /patches` (aggregated per patchId: `{ patchId, title, severity, category, cveIds, missingCount, installedCount, failedCount }` paginated, filter `severity, state, category`)
`GET /patches/summary` → `{ bySeverity: {severity, missing}[], devicesFullyPatched, devicesMissingCritical, totalMissing }`
`GET /patches/vulnerabilities` → `{ cveId, cvssScore, patchIds: string[], affectedDevices }[]` (vulnerability report)
`POST /patches/deploy` → `{ deviceIds?: string[], patchIds?: string[], severity?: PatchSeverity[] }` queues `INSTALL_PATCHES` → `{ commands: number }`

## Alerts — `/alerts`

`GET /alerts` (filters `status, severity, category, deviceId`), `GET /alerts/:id` (includes deliveries),
`POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve`, `POST /alerts/bulk` `{ ids, action: "acknowledge"|"resolve" }`.
Channels: `GET/POST/PATCH/DELETE /alerts/channels[/:id]` body `{ name, type, config, minSeverity, categories, enabled }` —
`config` is write-only (returned masked). `POST /alerts/channels/:id/test` sends a test message.

Channel `config` shapes:
- EMAIL `{ recipients: string[] }` (SMTP from env)
- SMS `{ provider: "twilio", to: string[] }` (Twilio creds from env)
- WHATSAPP `{ to: string[] }` (Twilio WhatsApp from env)
- SLACK `{ webhookUrl }`
- TEAMS `{ webhookUrl }`
- WEBHOOK `{ url, secret? }` (HMAC-SHA256 `X-SEM-Signature`)

## Audit — `/audit`

`GET /audit` (filters `category, action, actorId, resourceType, resourceId, deviceId, success, from, to`),
`GET /audit/:id`, `GET /audit/verify` → `{ valid: boolean, checked: number, brokenAt: string | null }`,
`GET /audit/login-history` (filters `userId, success, from, to`),
`GET /audit/export?format=csv&...filters` → file stream.

## Reports — `/reports`

`GET /reports` (list), `POST /reports` `{ name?, type: ReportType, format: ReportFormat, parameters?: { from?, to?, departmentId?, platform?, complianceState? } }` → `Report` (status QUEUED, generated by BullMQ worker),
`GET /reports/:id`, `GET /reports/:id/download` (file stream with Content-Disposition),
`DELETE /reports/:id`, `GET/POST/DELETE /reports/schedules[/:id]`.

## Users / Roles / Departments / Settings

- `GET /users` (filters `roleKey, departmentId, isActive`), `GET /users/:id`, `POST /users` `{ email, displayName, roleKey, departmentId?, password?, jobTitle?, phone? }`, `PATCH /users/:id`, `DELETE /users/:id` (deactivate), `POST /users/:id/reset-mfa`, `POST /users/:id/unlock`
- `GET /roles`, `PATCH /roles/:id` `{ permissions }` (SUPER_ADMIN), `GET /roles/permissions` → all permission strings
- `GET/POST/PATCH/DELETE /departments[/:id]`
- `GET /settings/ip-restrictions`, `POST` `{ cidr, description? }`, `DELETE /:id` — when ≥1 enabled rule exists, console API requests from other IPs get 403 (agent endpoints exempt)
- `GET /settings`, `PATCH /settings` `{ key: value }` (e.g. `sessionTimeoutMinutes`, `mfaRequiredRoles`)

---

## Agent protocol — `/agent`

All agent endpoints except `enroll` require `Authorization: Bearer <agentToken>` and `X-Device-Id`.
The agent token is a 48-byte random secret (`sem_agt_…`) stored hashed (SHA-256) server-side.
TLS is required in production; Nginx can additionally enforce mTLS with the device certificate on `/api/v1/agent/`.

### `POST /agent/enroll` (no auth; enrollment token in body)

```json
{
  "enrollmentToken": "sem_enr_...",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----...",   // RSA-2048 CSR (CN = serial number) generated by the agent (optional)
  "agentVersion": "1.0.0",
  "hardware": HardwareInfo
}
```
→ `201`
```json
{
  "deviceId": "uuid", "agentToken": "sem_agt_...", "status": "ACTIVE" | "PENDING",
  "certificatePem": "...", "caCertificatePem": "...",
  "policy": AgentPolicy, "checkinIntervalSec": 300
}
```
Re-enrolling a device with an existing `serialNumber` rotates its token and certificate (no duplicate row).

```ts
type HardwareInfo = {
  hostname: string; deviceName?: string; serialNumber: string; manufacturer?: string; model?: string;
  deviceType?: DeviceType; platform: OsPlatform; osName?: string; osVersion?: string; osBuild?: string;
  cpu?: string; ramMb?: number; storageGb?: number; ipAddress?: string; macAddresses?: string[];
  loggedInUser?: string; domain?: string;
};
```

### `POST /agent/heartbeat`
`{ agentVersion, uptimeSec?, loggedInUser? }` → `{ policy: AgentPolicy, policyVersion: number, commands: AgentCommand[], serverTime }`
Commands returned here are marked `SENT`.

### `POST /agent/report` — full state (every `inventoryIntervalSec`, or on change)
```ts
{
  collectedAt: string;
  hardware: HardwareInfo;
  security: {
    antivirusState: ProtectionState; antivirusProduct?: string; antivirusSignatureAt?: string;
    edrState: ProtectionState; edrProduct?: string; firewallState: ProtectionState;
    diskEncryptionState: ProtectionState; encryptionMethod?: string; bitlockerState?: ProtectionState;
    secureBootState: ProtectionState; tpmPresent?: boolean;
    screenLockEnabled?: boolean; screenLockTimeoutSec?: number; passwordOnWake?: boolean; screenSaverEnabled?: boolean;
    autoUpdateEnabled?: boolean; usbStorageEnabled?: boolean; pendingRebootRequired?: boolean; lastBootAt?: string;
    raw?: object;
  };
  software: { name: string; version?: string; publisher?: string; installDate?: string; installLocation?: string; sizeMb?: number; source?: string }[];
  patches: { patchId: string; title: string; category?: PatchCategory; severity?: PatchSeverity; state: PatchState; product?: string; cveIds?: string[]; cvssScore?: number; releasedAt?: string; installedAt?: string }[];
}
```
→ `{ complianceState, complianceScore, riskLevel, findings: ComplianceFinding[] }`
The server upserts inventory/security/patches, marks software not reported as `removedAt`,
classifies software, audits install/removal (category SOFTWARE), and evaluates compliance.

### `POST /agent/usb-events`
`{ events: { eventType: UsbEventType; deviceClass: UsbDeviceClass; vendorId?; productId?; serialNumber?; label?; userName?; filePath?; bytes?; policyReason?; occurredAt: string }[] }` → `{ accepted: number }`
BLOCKED events raise an Alert (category USB, severity MEDIUM, deduped per device+usb serial per hour).

### `POST /agent/software-events`
`{ events: { action: "INSTALLED" | "REMOVED" | "BLOCKED"; name; version?; publisher?; userName?; occurredAt }[] }` → `{ accepted }`

### `POST /agent/certificate/renew`
`{ csrPem: string }` (new RSA-2048 CSR) → `200 { certificatePem, caCertificatePem, expiresAt }`
Authenticated by the agent token, so it also works for an expired or missing certificate.
The previous certificate is revoked and a `device.certificate.renew` audit entry is written.
Agents call this automatically 30 days before expiry (`sem-agent renew-cert` forces it).

### `POST /agent/commands/:id/result`
`{ status: "SUCCEEDED" | "FAILED"; output?: string; error?: string; data?: object }` → `204`

### `GET /agent/policy` → `AgentPolicy`

```ts
type AgentPolicy = {
  policyId: string; version: number; name: string;
  usb: { blockStorage: boolean; readOnly: boolean; allowWhitelisted: boolean;
         whitelist: { vendorId: string; productId: string; serialNumber: string; readOnly: boolean; expiresAt: string | null }[] };
  software: { blockUnauthorized: boolean; autoUninstallBlacklisted: boolean;
              blacklist: { name: string; publisher: string | null; matchType: MatchType }[] };
  security: { requireAntivirus; requireEdr; requireFirewall; requireDiskEncryption; requireSecureBoot: boolean };
  updates: { autoUpdateEnabled: boolean; autoPatchDeployment: boolean; patchDeadlineDays: number; maintenanceWindow: string | null };
  screenLock: { enabled: boolean; timeoutSec: number; requirePassword: boolean; screenSaver: boolean };
  checkinIntervalSec: number; inventoryIntervalSec: number;
};
type AgentCommand = { id: string; type: CommandType; payload: object; expiresAt: string };
// AgentPolicy also carries `workforce` (tracking settings) and the agent posts to
// `POST /agent/activity` and `POST /agent/screenshots` — see docs/WORKFORCE.md "Agent protocol additions".
```

Command payloads:
- `UNINSTALL_SOFTWARE` `{ name, version? }`
- `INSTALL_PATCHES` `{ patchIds?: string[], severity?: PatchSeverity[], reboot: "never"|"if-required" }`
- `APPLY_POLICY` `{ version }` — agent re-fetches policy and enforces it
- `COLLECT_INVENTORY` `{}` — send `/agent/report` now
- `LOCK_SCREEN` `{}`; `RESTART` `{ delaySec }`; `ENABLE_ENCRYPTION` `{}`; `REFRESH_USB_RULES` `{}`
