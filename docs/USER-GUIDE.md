# SecureEndpoint Manager — User Guide

This guide is for people who use the SecureEndpoint Manager admin console day to day: security
and IT administrators, compliance officers, department managers, auditors and employees. It
explains how to sign in, what each role can do, and walks through the most common tasks.

Console screens may evolve. Every step therefore names the console area **and** the underlying
API endpoint in parentheses (paths are relative to `/api/v1`), so the instructions stay accurate
and can also be scripted. The full API contract is in [API.md](API.md). For how compliance is
calculated see [Compliance Engine](COMPLIANCE-ENGINE.md); for security controls see
[Security](SECURITY.md).

---

## 1. Getting started

### 1.1 Console layout

The navigation menu shows only the areas your role can access:

| Group | Areas |
|---|---|
| Overview | Dashboard |
| Endpoints | Devices ("My Devices" for employees), Enrollment, Policies |
| Protection | Compliance, Security, Patches, USB Control ("USB Access" for employees), Software |
| Operations | Alerts, Reports, Audit Logs |
| Administration | Users, Departments, Roles, Settings |

Settings (your profile, MFA and sessions) is available to every signed-in user.

### 1.2 Signing in

The login page offers the methods your administrator has configured:

| Method | How | API |
|---|---|---|
| Local account | Email and password | `POST /auth/login` |
| LDAP / Active Directory | Directory username and password | `POST /auth/ldap/login` |
| Single sign-on | Click the provider button (Microsoft Azure AD or your OIDC provider) | `GET /auth/sso/providers`, then `/auth/sso/azure-ad/login` or `/auth/sso/oidc/login` |

Only configured SSO providers are shown. After SSO, the identity provider redirects back to the
console, which completes the sign-in automatically.

**Password rules (local accounts):** at least 12 characters with upper-case, lower-case, a digit
and a symbol. Change your password in Settings (`POST /auth/change-password`).

**Lockout:** 5 failed attempts lock the account for 15 minutes. An administrator with
`users:write` can unlock it earlier (`POST /users/:id/unlock`).

### 1.3 Multi-factor authentication (MFA)

MFA uses a time-based one-time password (TOTP) app such as Microsoft Authenticator, Google
Authenticator or any RFC 6238 compatible app.

**Enrol:**

1. Open **Settings -> Security**.
2. Start MFA setup; the console shows a QR code and the secret (`POST /auth/mfa/setup`).
3. Scan the QR code with your authenticator app.
4. Enter the 6-digit code to confirm (`POST /auth/mfa/enable`).
5. The console displays your **recovery codes** once. Store them somewhere safe (password
   manager or printed in a secure place). Each code can be used once instead of a TOTP code.

**Sign in with MFA:** after your password (or SSO), enter the code from your app or a recovery
code (`POST /auth/mfa/verify`). The MFA step must be completed within 5 minutes.

**Forced enrolment:** roles listed in `SECURITY_MFA_REQUIRED_ROLES` (by default `SUPER_ADMIN`
and `SECURITY_ADMIN`) must use MFA. If you hold such a role and have not enrolled, the console
sends you straight to **Settings -> Security** after login until MFA is enabled.

**Lost your device?** Use a recovery code, then disable and re-enrol MFA
(`POST /auth/mfa/disable`, then set up again). If you have no recovery codes left, ask an
administrator with `users:write` to reset your MFA (`POST /users/:id/reset-mfa`).

### 1.4 Sessions and idle timeout

- Access tokens are short-lived (15 minutes) and refreshed automatically while you work.
- Sessions end after a period of inactivity (default 30 minutes; administrators can change
  `sessionTimeoutMinutes` in Settings) and after the refresh-token lifetime (default 7 days).
- **Settings -> Sessions** lists your active sessions with IP address, browser and last activity
  (`GET /auth/sessions`). Revoke one (`DELETE /auth/sessions/:id`) or all others
  (`DELETE /auth/sessions`). Always revoke sessions you do not recognize and change your password.
- **Sign out** revokes the current session (`POST /auth/logout`).
- If your organization uses IP restrictions, the console is reachable only from approved
  networks; requests from elsewhere receive "403 Forbidden".

---

## 2. Roles at a glance

SecureEndpoint Manager has seven built-in roles. Permissions are seeded as below and can be
adjusted by a Super Admin (`PATCH /roles/:id`).

| Capability | Super Admin | Security Admin | Compliance Officer | IT Admin | Dept. Manager | Employee | Auditor |
|---|---|---|---|---|---|---|---|
| View dashboard | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View devices | All | All | All | All | Own dept. | Own devices | All |
| Edit devices, assign users | Yes | Yes | - | Yes | - | - | - |
| Send device commands, quarantine | Yes | Yes | - | Yes | - | - | - |
| Manage enrollment tokens, approve devices | Yes | Yes | - | Yes | - | - | - |
| View policies | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Create / edit / assign policies | Yes | Yes | - | - | - | - | - |
| View software inventory | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Manage whitelist / blacklist, uninstall | Yes | Yes | - | Yes | - | - | - |
| View USB devices and events | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Manage USB whitelist | Yes | Yes | - | Yes | - | - | - |
| Approve USB access requests | Yes | Yes | - | Yes | Yes | - | - |
| Request temporary USB access | Yes | Yes | Yes | Yes | Yes | Yes | - |
| View security posture and patches | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Deploy patches | Yes | Yes | - | Yes | - | - | - |
| View compliance | Yes | Yes | Yes | Yes | Yes | Own devices | Yes |
| Tune rules, trigger evaluations | Yes | Yes | Yes | - | - | - | - |
| View alerts | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Acknowledge / resolve alerts | Yes | Yes | Yes | Yes | - | - | - |
| Configure alert channels | Yes | Yes | - | - | - | - | - |
| View and create reports | Yes | Yes | Yes | Yes | Yes | - | Yes |
| View audit trail | Yes | Yes | Yes | - | - | - | Yes |
| View users and departments | Yes | Yes | Yes | Yes | Yes | - | Yes |
| Create / edit users | Yes | - | - | Yes | - | - | - |
| Edit role permissions | Yes | - | - | - | - | - | - |
| System settings, IP restrictions | Yes | Yes | - | - | - | - | - |

**Row scoping** is enforced by the server, not only hidden in the console:

- **Department Manager** sees only devices, users and events of their own department(s).
- **Employee** sees only devices assigned to them.

Your exact permissions are listed in your profile (`GET /auth/me`, field `permissions`).

---

## 3. Guides by role

### 3.1 Super Admin

Full control of the platform, including identity and roles.

- Create users and assign roles and departments (**Users**, `POST /users`); deactivate leavers
  (`DELETE /users/:id`).
- Maintain departments and their managers and default policies (**Departments**, `/departments`).
- Adjust role permissions (**Roles**, `PATCH /roles/:id`; list all permission strings with
  `GET /roles/permissions`).
- Configure system settings such as `sessionTimeoutMinutes` and `mfaRequiredRoles`
  (**Settings**, `PATCH /settings`) and console IP restrictions (`/settings/ip-restrictions`).
  Add your own network before enabling the first rule, or you will lock yourself out.
- Permanently delete a device record when strictly necessary (`DELETE /devices/:id?hard=true`,
  Super Admin only). Prefer retiring.
- Everything the Security Admin can do.

### 3.2 Security Admin

Owns the security baseline, policies and alerting.

- Design policies and assign them to departments and devices ([walkthrough b](#b-create-and-assign-a-policy)).
- Tune compliance rules (`PATCH /compliance/rules/:id`) and trigger evaluations.
- Configure alert channels and triage alerts ([walkthrough g](#g-respond-to-alerts)).
- Maintain software whitelist/blacklist and USB whitelist; approve USB requests.
- Quarantine a compromised device (`POST /devices/:id/quarantine`, later `/release`) and send
  commands such as `LOCK_SCREEN` or `ENABLE_ENCRYPTION` (`POST /devices/:id/commands`).
- Review the audit trail and login history ([walkthrough f](#f-audit-review)).
- Manage console IP restrictions and security settings.

### 3.3 Compliance Officer

Monitors and reports on compliance; does not change devices or policies.

- Watch **Dashboard** and **Compliance** for the compliance rate, top violations and department
  compliance (`/dashboard/*`, `GET /compliance/summary`, `GET /compliance/results`).
- Tune rule severity, weight and whether a rule makes a device non-compliant
  (`PATCH /compliance/rules/:id`), and re-run evaluations (`POST /compliance/evaluate`).
- Acknowledge and resolve alerts.
- Generate and schedule compliance, audit and other reports ([walkthrough e](#e-generate-and-schedule-reports)).
- Review the audit trail.

### 3.4 IT Admin

Runs the fleet: enrollment, inventory, software, USB and patching.

- Enroll and approve devices ([walkthrough a](#a-enroll-devices)).
- Maintain inventory: device details, asset IDs, warranty, assignment to users
  (`PATCH /devices/:id`, `POST /devices/:id/assign`, `/unassign`, `GET /devices/:id/assignments`).
- Retire devices (`DELETE /devices/:id`), which revokes the agent token and certificates.
- Handle unauthorized software ([walkthrough d](#d-handle-unauthorized-software)) and licenses
  (`GET /software/licenses`).
- Manage the USB whitelist and approve USB requests ([walkthrough c](#c-usb-temporary-access)).
- Deploy patches ([walkthrough h](#h-patch-deployment)).
- Create and edit user accounts (`/users`).

### 3.5 Department Manager

Oversees the devices and people in their department.

- View department devices, compliance, security posture, patches, software and USB activity.
  All lists are automatically limited to the manager's department(s).
- Check department compliance on the Dashboard (`GET /dashboard/department-compliance`).
- Approve or deny USB temporary access requests from team members
  ([walkthrough c](#c-usb-temporary-access)).
- Generate reports for the department (`POST /reports` with `parameters.departmentId`).

### 3.6 Employee

Sees only their own devices.

- **My Devices** shows your assigned devices, their compliance state, score and the findings
  with remediation advice (`GET /devices`, `GET /devices/:id`, `GET /devices/:id/compliance`).
  Each finding includes a `remediation` text that explains how to fix it.
- **USB Access** lets you request temporary access for a USB storage device
  ([walkthrough c](#c-usb-temporary-access)).
- Manage your password, MFA and sessions in **Settings**.

If a device you use is missing or shows another person, contact IT.

### 3.7 Auditor

Read-only oversight.

- Read devices, policies, compliance, software, USB, security, patches, alerts and users.
- Review the full audit trail, verify its integrity and export it ([walkthrough f](#f-audit-review)).
- Generate reports (`POST /reports`) for evidence collection.
- Auditors cannot change configuration, acknowledge alerts or request USB access.

---

## 4. Walkthroughs

### a. Enroll devices

Required permission: `enrollment:manage` (Super Admin, Security Admin, IT Admin).

**1. Create an enrollment token** — **Enrollment -> Tokens -> New token** (`POST /enrollment/tokens`).

| Field | Purpose |
|---|---|
| `name` | Descriptive label, e.g. "Finance laptops Q4" |
| `platform` | Optional: restrict to `WINDOWS`, `LINUX` or `MACOS` |
| `departmentId` | Optional: department assigned to devices enrolled with this token |
| `policyId` | Optional: policy assigned to devices enrolled with this token |
| `maxUses` | Maximum number of enrollments (default 100) |
| `expiresInDays` | Token lifetime |
| `autoApprove` | `true` (default): devices become `ACTIVE` immediately; `false`: devices wait in `PENDING` for approval |

The raw token (`sem_enr_...`) is shown **only once**. Treat it like a password; anyone who holds
it can enroll a device until it expires, is used up, or is revoked.

**2. Get the install command** — select the token and platform; the console shows a ready-made
one-liner (`GET /enrollment/install-command?tokenId=<id>&platform=<WINDOWS|LINUX|MACOS>`, returns
`{ platform, command, downloadUrl }`).

| Platform | Shell | Notes |
|---|---|---|
| Windows | PowerShell | Run in an elevated (Administrator) PowerShell session |
| Linux | bash | Run as root or with `sudo` |
| macOS | zsh / bash | Run with administrator rights |

The installer downloads the agent from `https://<your-domain>/downloads/` (binaries,
`install.ps1`, `install.sh`, `install-macos.sh` and `checksums.txt`) and enrolls the device. You
can distribute the command with your existing software deployment tool.

**3. Approve pending devices** (only if `autoApprove` was `false`) — **Enrollment -> Pending**
(`GET /enrollment/pending`). Verify each device (hostname, serial number, platform) and click
**Approve** or **Reject** (`POST /enrollment/devices/:id/approve` / `.../reject`).

**4. Verify check-in** — open **Devices** and find the device (`GET /devices?search=<hostname>`):

- `status` is `ACTIVE` and the device shows as **online** (seen within the last 15 minutes).
- `agentVersion`, `enrolledAt` and `lastSeenAt` are populated.
- After the first full report, `complianceState` changes from `UNKNOWN` to `COMPLIANT` or
  `NON_COMPLIANT`, and software, patches and security posture appear on the device page.

The agent checks in every `checkinIntervalSec` (default 300 s) and sends a full report every
`inventoryIntervalSec` (default 3600 s). To get data immediately, send `COLLECT_INVENTORY`
(`POST /devices/:id/commands` `{ "type": "COLLECT_INVENTORY" }`).

**Housekeeping:** revoke tokens that are no longer needed (`DELETE /enrollment/tokens/:id`).
Re-installing the agent on the same machine re-uses the device record (matched by serial number)
and rotates its credentials.

### b. Create and assign a policy

Required permission: `policies:write` (Super Admin, Security Admin).

**1. Create the policy** — **Policies -> New policy** (`POST /policies`). Fields are grouped:

| Group | Fields (defaults) |
|---|---|
| General | `name`, `description`, `isDefault`, `priority` (100) |
| Data access | `companyDataOnlyManaged` (true) |
| USB | `usbStorageBlocked` (true), `allowWhitelistedUsb` (true), `usbReadOnly` (false) |
| Software | `blockUnauthorizedSoftware` (true), `autoUninstallBlacklisted` (false) |
| Endpoint protection | `requireAntivirus` (true), `requireEdr` (true), `requireFirewall` (true), `requireDiskEncryption` (true), `requireSecureBoot` (false), `maxAvSignatureAgeDays` (3) |
| Updates | `autoUpdateEnabled` (true), `autoPatchDeployment` (true), `patchDeadlineDays` (14), `maintenanceWindow` (cron expression, optional) |
| Screen lock | `screenLockEnabled` (true), `screenLockTimeoutSec` (300), `requirePasswordOnWake` (true), `screenSaverEnforced` (true) |
| Agent | `checkinIntervalSec` (300), `inventoryIntervalSec` (3600) |

See [Compliance Engine -> Policy tuning](COMPLIANCE-ENGINE.md#112-policy-tuning) for how each
field affects compliance.

**2. Assign it** — **Policies -> (policy) -> Assign** (`POST /policies/:id/assign` with
`{ "deviceIds": [...] }` and/or `{ "departmentIds": [...] }`).

The effective policy for a device is resolved as: device assignment -> department policy ->
default policy. Check what a specific device gets with `GET /policies/effective/:deviceId`, and
list devices using a policy with `GET /policies/:id/devices`.

**3. Change it later** — edit and save (`PATCH /policies/:id`). Each save:

- increments the policy `version`;
- queues an `APPLY_POLICY` command for affected devices, which re-fetch and enforce the policy at
  their next check-in;
- re-evaluates compliance for those devices.

The default policy cannot be deleted (`DELETE /policies/:id` is refused for it).

### c. USB temporary access

USB storage is blocked by default. Permanently approved devices go on the USB whitelist
(**USB Control -> Devices**, `POST /usb/devices`, permission `usb:write`); one-off needs use
temporary access requests.

**Employee: request access** — **USB Access -> New request** (`POST /usb/requests`, permission
`usb:request`):

| Field | Notes |
|---|---|
| `deviceId` | The computer you want to use the USB device on |
| `vendorId`, `productId`, `serialNumber` | Identify the USB device (shown in the blocked-device notification or USB events) |
| `reason` | Business justification (required) |
| `durationHours` | 1 to 72 hours |
| `readOnly` | Request read-only access where possible |

The request starts as `PENDING`.

**Approver: decide** — users with `usb:approve` (Super Admin, Security Admin, IT Admin,
Department Manager for their department) open **USB Control -> Requests** and filter by
`status=PENDING` (`GET /usb/requests?status=PENDING`):

- **Approve** (`POST /usb/requests/:id/approve` `{ note?, durationHours? }`): sets `expiresAt`
  (the approver may shorten or change the duration) and queues `REFRESH_USB_RULES` so the agent
  applies the new rule at its next check-in.
- **Deny** (`POST /usb/requests/:id/deny` `{ note? }`).
- **Revoke** an approved request early (`POST /usb/requests/:id/revoke`).

**Expiry** — when `expiresAt` passes, the request becomes `EXPIRED` and the device is blocked
again. Request statuses: `PENDING`, `APPROVED`, `DENIED`, `EXPIRED`, `REVOKED`.

**Monitoring** — **USB Control** shows blocked and allowed events (`GET /usb/events`,
`GET /usb/stats`). Blocked events raise a `USB` alert (severity MEDIUM, de-duplicated per device
and USB serial per hour).

### d. Handle unauthorized software

Required permission: `software:write` (Super Admin, Security Admin, IT Admin).

1. **Review** — **Software -> Unauthorized** lists installations with status `UNAUTHORIZED` or
   `BLACKLISTED` and the device they are on (`GET /software/unauthorized`). Use
   **Software -> Inventory** (`GET /software/inventory`, `GET /software/inventory/:name/devices`)
   for the fleet-wide view.
2. **Decide** for each application:
   - **Approve** — add it to the whitelist (`POST /software/whitelist`) with `name`, optional
     `publisher`, `matchType` (`EXACT`, `CONTAINS`, `REGEX`), `platform`, and optional licensing
     data (`licenseType`, `licenseCount`, `licenseExpiresAt`, `costPerSeat`, write-only
     `licenseKey`).
   - **Prohibit** — add it to the blacklist (`POST /software/blacklist`) with `reason`,
     `severity` and optionally `autoUninstall`.
3. **Reclassify** — apply list changes to existing inventory immediately
   (`POST /software/reclassify`, returns `{ updated }`). Otherwise classification updates on the
   next agent report.
4. **Remove** — select devices and uninstall (`POST /software/uninstall`
   `{ "deviceIds": [...], "name": "<application>" }`), which queues `UNINSTALL_SOFTWARE`
   commands. Track results on each device's command list (`GET /devices/:id/commands`). Policies
   with `autoUninstallBlacklisted` let the agent remove blacklisted software automatically.
5. **Verify** — after the agent's next report (or `POST /devices/:id/evaluate`), the
   `UNAUTHORIZED_SOFTWARE` finding should pass and the device return to compliant if nothing else
   fails.

Classification order: blacklist -> `BLACKLISTED`; whitelist -> `APPROVED`; otherwise
`UNAUTHORIZED` when the policy blocks unauthorized software, else `UNKNOWN`. Operating-system
components are approved automatically. Check license usage under **Software -> Licenses**
(`GET /software/licenses`, compliance `OK`, `OVER` or `EXPIRED`).

### e. Generate and schedule reports

Required permission: `reports:create` (all roles except Employee).

**On demand** — **Reports -> New report** (`POST /reports`):

| Field | Values |
|---|---|
| `type` | `COMPLIANCE`, `DEVICE`, `SOFTWARE`, `SECURITY`, `AUDIT`, `USB`, `PATCH` |
| `format` | `PDF`, `XLSX`, `CSV` |
| `name` | Optional |
| `parameters` | Optional filters: `from`, `to`, `departmentId`, `platform`, `complianceState` |

Reports are generated in the background. Status moves `QUEUED` -> `RUNNING` -> `COMPLETED` (or
`FAILED` with an error). Download a completed report from the list (`GET /reports/:id/download`)
and delete old ones (`DELETE /reports/:id`).

**Scheduled** — **Reports -> Schedules -> New schedule** (`POST /reports/schedules`) with
`name`, `type`, `format`, `cron`, `parameters`, `recipients` (email addresses) and `enabled`.
Cron examples:

| Cron | Runs |
|---|---|
| `0 7 * * 1` | Every Monday at 07:00 |
| `0 6 1 * *` | First day of each month at 06:00 |
| `0 18 * * 1-5` | Weekdays at 18:00 |

List schedules with `GET /reports/schedules`; remove one with `DELETE /reports/schedules/:id`.
To change a schedule, delete it and create a new one.

### f. Audit review

Required permission: `audit:read` (Super Admin, Security Admin, Compliance Officer, Auditor).

1. **Browse** — **Audit Logs** (`GET /audit`). Filter by `category` (`USER_ACTION`,
   `DEVICE_CHANGE`, `POLICY_CHANGE`, `AUTH`, `USB`, `SOFTWARE`, `SECURITY`, `SYSTEM`), `action`
   (e.g. `policy.create`), `actorId`, `resourceType`, `resourceId`, `deviceId`, `success`, and a
   `from` / `to` date range. Open an entry for the before/after values (`GET /audit/:id`).
2. **Device timeline** — on a device page, the timeline shows the audit entries for that device
   (`GET /devices/:id/timeline`).
3. **Login history** — successful and failed sign-ins with provider, IP and whether MFA was used
   (`GET /audit/login-history`, filters `userId`, `success`, `from`, `to`). Look for repeated
   failures and unfamiliar IP addresses.
4. **Verify integrity** — the audit log is append-only and hash-chained. Run **Verify**
   (`GET /audit/verify`); it returns `{ valid, checked, brokenAt }`. `valid: false` means a row
   was altered or removed at `brokenAt`: escalate to the security team immediately
   (see [Security](SECURITY.md)).
5. **Export** — export the filtered view as CSV (`GET /audit/export?format=csv&...filters`) or
   create an `AUDIT` report.

### g. Respond to alerts

View: `alerts:read`. Acknowledge/resolve: `alerts:write`. Channels: `alerts:configure`.

**Triage** — **Alerts** (`GET /alerts`, filters `status`, `severity`, `category`, `deviceId`):

1. Sort by severity; start with `CRITICAL` and `HIGH`.
2. Open the alert (`GET /alerts/:id`) to see the device, rule, message, occurrence count and
   delivery history.
3. **Acknowledge** it to show you are working on it (`POST /alerts/:id/acknowledge`).
4. Fix the cause (for compliance alerts, follow the finding's remediation on the device page).
5. **Resolve** it (`POST /alerts/:id/resolve`). Compliance alerts also resolve automatically when
   the rule passes on the next evaluation.
6. Handle many at once with bulk actions (`POST /alerts/bulk`
   `{ "ids": [...], "action": "acknowledge" | "resolve" }`).

Statuses: `OPEN` -> `ACKNOWLEDGED` -> `RESOLVED`. Categories: `COMPLIANCE`, `USB`, `SOFTWARE`,
`SECURITY`, `PATCH`, `AUTH`, `DEVICE`, `SYSTEM`. Severities: `INFO`, `LOW`, `MEDIUM`, `HIGH`,
`CRITICAL`.

**Configure channels** — **Alerts -> Channels** (`/alerts/channels`):

| Type | `config` |
|---|---|
| `EMAIL` | `{ "recipients": ["soc@example.com"] }` |
| `SMS` | `{ "provider": "twilio", "to": ["+15551234567"] }` |
| `WHATSAPP` | `{ "to": ["+15551234567"] }` |
| `SLACK` | `{ "webhookUrl": "https://hooks.slack.com/..." }` |
| `TEAMS` | `{ "webhookUrl": "https://..." }` |
| `WEBHOOK` | `{ "url": "https://...", "secret": "optional" }` (signed with `X-SEM-Signature`) |

Also set `minSeverity` (default `HIGH`), `categories` and `enabled`. The `config` is stored
encrypted and shown masked after saving. Click **Test** to send a test message
(`POST /alerts/channels/:id/test`). If deliveries fail, check the alert's delivery history and
the [Runbook](RUNBOOK.md).

### h. Patch deployment

View: `patches:read`. Deploy: `patches:deploy` (Super Admin, Security Admin, IT Admin).

1. **Assess** — **Patches** shows missing patches aggregated by patch
   (`GET /patches`, filters `severity`, `state`, `category`) and a summary
   (`GET /patches/summary`: devices fully patched, devices missing critical patches, total
   missing). **Patches -> Vulnerabilities** maps CVEs and CVSS scores to patches and affected
   devices (`GET /patches/vulnerabilities`).
2. **Deploy** — select devices and/or patches, or a severity, and deploy
   (`POST /patches/deploy` `{ deviceIds?, patchIds?, severity? }`, e.g.
   `{ "severity": ["CRITICAL", "IMPORTANT"] }`). This queues `INSTALL_PATCHES` commands and
   returns `{ commands }`.
   For a single device with explicit reboot behaviour, send the command directly:
   `POST /devices/:id/commands`
   `{ "type": "INSTALL_PATCHES", "payload": { "severity": ["CRITICAL"], "reboot": "if-required" } }`
   (`reboot` is `never` or `if-required`).
3. **Track** — follow command status on the device (`GET /devices/:id/commands`: `PENDING`,
   `SENT`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`) and per-patch state
   (`GET /devices/:id/patches`: `INSTALLED`, `MISSING`, `PENDING_INSTALL`, `FAILED`).
4. **Verify** — after the next report, `CRITICAL_PATCHES_MISSING` should pass. Critical patches
   still missing after the policy's `patchDeadlineDays` (default 14) make the device
   non-compliant.

**Automatic patching** — policies with `autoPatchDeployment` and an optional `maintenanceWindow`
(cron expression) let the platform patch without manual deployment; `autoUpdateEnabled`
requires the operating system's own automatic updates to stay on.

---

## 5. Demo accounts

When the platform is installed with `SEED_DEMO_DATA=true` (evaluation and test environments
only), the following demo users exist, all with the password `ChangeMe!Secure2026`:

| Email | Role |
|---|---|
| `admin@secureendpoint.local` | SUPER_ADMIN |
| `secadmin@secureendpoint.local` | SECURITY_ADMIN |
| `compliance@secureendpoint.local` | COMPLIANCE_OFFICER |
| `itadmin@secureendpoint.local` | IT_ADMIN |
| `manager@secureendpoint.local` | DEPARTMENT_MANAGER |
| `employee@secureendpoint.local` | EMPLOYEE |
| `auditor@secureendpoint.local` | AUDITOR |

These accounts do not exist unless demo data was seeded. Never enable demo data in production;
if it was enabled by mistake, deactivate the accounts or change their passwords immediately. The
Super Admin and Security Admin demo users are required to enrol MFA on first login.

---

## 6. Troubleshooting for users

| Symptom | What to do |
|---|---|
| "Account locked" | Wait 15 minutes or ask an administrator to unlock you |
| Sent to Settings -> Security after login | Your role requires MFA; complete enrolment |
| MFA code rejected | Check your phone's clock is set automatically; try a recovery code |
| 403 on every page | Your network may not be on the IP allow-list, or your role lacks the permission |
| Device stays `UNKNOWN` | It has not sent its first full report; check it is approved and online |
| Device still non-compliant after a fix | Wait for the next report, or ask IT to re-evaluate (`POST /devices/:id/evaluate`) |
| USB device still blocked after approval | The agent applies the change at its next check-in (within `checkinIntervalSec`) |

---

## 7. Glossary

| Term | Meaning |
|---|---|
| Agent | The SecureEndpoint service installed on each device; reports state and executes commands |
| Agent token | Per-device secret (`sem_agt_...`) the agent uses to authenticate |
| Alert channel | A delivery destination for alerts (email, SMS, WhatsApp, Slack, Teams, webhook) |
| Audit hash chain | Each audit row stores a SHA-256 hash including the previous row's hash, making tampering detectable |
| Command | An action queued for a device (e.g. `APPLY_POLICY`, `UNINSTALL_SOFTWARE`, `INSTALL_PATCHES`) |
| Compliance score | 0-100; 100 minus the weights of failed rules |
| Compliance state | `COMPLIANT`, `NON_COMPLIANT` or `UNKNOWN` |
| Effective policy | The policy that applies to a device: device -> department -> default |
| Enrollment token | Secret (`sem_enr_...`) that allows new devices to register |
| Finding | The result of one rule for one device, with detail and remediation |
| markNonCompliant | Rule setting that makes a failure turn the device non-compliant |
| MFA | Multi-factor authentication using a TOTP app or recovery codes |
| Quarantine | Device status used to isolate a device pending investigation |
| Risk level | Highest severity among failed rules: `NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| Row scoping | Server-side restriction of data to a manager's department or an employee's own devices |
| Temporary USB access | Time-limited (1-72 h) approval for a specific USB device on a specific computer |
| Whitelist / blacklist | Approved and prohibited software (or approved USB devices) |

Related documents: [API](API.md), [Compliance Engine](COMPLIANCE-ENGINE.md),
[Security](SECURITY.md), [Architecture](ARCHITECTURE.md), [Runbook](RUNBOOK.md).
