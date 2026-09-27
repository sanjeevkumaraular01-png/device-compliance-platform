# Self-Service Device Enrollment — Contract (v1)

One link for employees: **`https://DOMAIN/install`** → sign in with company email →
download the agent → install → their Windows device is bound to them and appears in the
dashboard (pending admin approval). Reuses the existing auth, users, devices, enrollment
tokens, agent and dashboard — no parallel systems.

## Decisions (fixed)

- **Login:** company **email + password verified over IMAP** against the company mail
  server. The password is used once for an IMAP `LOGIN`, never stored, never a new
  SecureEndpoint password. Only configured email domains are allowed.
- **Installer:** a real **`SecureEndpoint-Agent-x64.msi`** (static, same for everyone) +
  a **one-click `SecureEndpoint-Setup.cmd`** generated per employee that runs
  `msiexec /i …\SecureEndpoint-Agent-x64.msi DEPLOY_TOKEN=<one-time> SERVER=<url>`.
- **Approval:** enrolled devices land **PENDING**; an admin approves them.

## Security model (the browser↔agent binding)

```
email+password ──IMAP verify──► employee resolved (User)
        │
        └─► single-use deployment credential  sem_enr_…  (EnrollmentToken with
            assignToUserId = employee, maxUses = 1, autoApprove = false, expires ~20 min)
                        │
        Agent enroll (installer) presents the credential ──► device created + bound to that
                        │                                     exact employee, token consumed
                        └─► credential is now used/expired → invalid
```

- The credential is **short-lived, single-use, and bound to one employee**. No permanent
  secret is placed in the installer or on the machine.
- The employee's email password never leaves the backend and is never persisted.
- The MSI itself is generic; only the one-time `DEPLOY_TOKEN` is personalized (in the `.cmd`).

## Schema additions

- `EnrollmentToken.assignToUserId` (uuid, nullable) → when set, `/agent/enroll` binds the
  device to that user regardless of the OS username, and creates the assignment.
- `AuthProvider.IMAP` → provider for employees provisioned via company-mail login.

No other schema changes; devices, assignments and the pending/approve queue already exist.

## Config (env + admin-editable settings)

Env (`.env`): `DEPLOY_ENABLED=true`, `DEPLOY_IMAP_HOST`, `DEPLOY_IMAP_PORT=993`,
`DEPLOY_IMAP_SECURE=true`, `DEPLOY_ALLOWED_DOMAINS` (comma list, e.g. `webyne.com`),
`DEPLOY_COMPANY_NAME`, `DEPLOY_SESSION_TTL_MIN=20`, `DEPLOY_DOWNLOAD_BASE_URL` (defaults to
`AGENT_DOWNLOAD_BASE_URL`). Admins can override company name / allowed domains / IMAP host
in the console (stored as `SystemSetting` rows: `deploy.companyName`, `deploy.allowedDomains`,
`deploy.imapHost`, `deploy.imapPort`, `deploy.imapSecure`, `deploy.enabled`). Settings win
over env when present. When IMAP host is unset → `/deploy/*` returns 503 "not configured".

## Public API — `/deploy` (no console auth; rate-limited like `/auth`)

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/deploy/config` | `{ enabled, companyName, allowedDomains: string[], agentDownloadUrl }` — for the `/install` page (no secrets). |
| POST | `/deploy/session` | `{ email, password }` → IMAP verify + domain check → resolve/create employee → create the single-use deployment credential. Returns `SessionResponse`. 401 on bad credentials, 403 on disallowed domain, 429 on rate limit, 503 when not configured. |
| GET | `/deploy/setup.cmd?token=<deployToken>` | streams the personalized one-click `SecureEndpoint-Setup.cmd` (text/plain, `Content-Disposition: attachment`). Validates the token is live/unused before streaming; does not consume it. |
| GET | `/deploy/status?token=<deployToken>` | `{ state: "PENDING_DOWNLOAD" \| "ENROLLED_PENDING_APPROVAL" \| "ACTIVE" \| "EXPIRED", device?: { name, os, lastSeenAt, complianceState } }` so the page can show "Installation complete". |

```ts
type SessionResponse = {
  deployToken: string;              // sem_enr_… one-time, ~20 min
  expiresAt: string;
  employee: { email: string; displayName: string };
  downloadUrl: string;              // MSI (static)
  setupUrl: string;                 // /deploy/setup.cmd?token=… (personalized one-click)
  serverUrl: string;                // API_PUBLIC_URL / DOMAIN
  instructions: string;
};
```

The employee is provisioned as a `User` (role EMPLOYEE, `authProvider = IMAP`) if new; an
existing user with the same email is reused (never a duplicate). Creating a session is
audited (`deploy.session.create`, no password). Rate limit: per-IP and per-email.

## Agent enroll change

`/agent/enroll` (unchanged shape) now: if the presented token has `assignToUserId`, the new
device is assigned to that user (assignment row created), overriding OS-username matching.
With `autoApprove=false` the device is `PENDING` until an admin approves — exactly the
existing pending/approve queue (`/enrollment/pending`, `/enrollment/devices/:id/approve`).

## MSI

`SecureEndpoint-Agent-x64.msi` (built with WiX/msitools):
- Installs `sem-agent.exe` to `C:\Program Files\SecureEndpoint\`, registers the service.
- Properties: `SERVER` (required), `DEPLOY_TOKEN` (required), `CA` (optional), `INSECURE` (lab only).
- On install: runs `sem-agent enroll --server <SERVER> --token <DEPLOY_TOKEN>` then
  `sem-agent install` + starts the service. On uninstall: `sem-agent uninstall`.
- Supports upgrade (same ProductCode/UpgradeCode major-upgrade) and `msiexec /x` uninstall.
- `SecureEndpoint-Setup.cmd` (generated per employee) just calls msiexec with the properties,
  downloading the MSI first if not local. One double-click for the employee.

## Console (admin)

- **Settings → Deployment** (`settings:write`): company name, allowed email domains, IMAP
  host/port/secure, enable toggle, links to the MSI and the `/install` page, and a live count
  of pending self-enrolled devices (links to the existing pending queue).
- The existing **Devices** dashboard already shows employee, device name, OS, agent version,
  online/offline, compliance and last-seen — no change needed. Self-enrolled pending devices
  appear in `/enrollment` (pending approval) with the bound employee.

## `/install` page (public, outside the console shell)

1. Branded screen: "Sign in with your company account" → email + password.
2. On success: "Welcome, <email> — download the agent" → **Download `.msi`** + **one-click
   Setup** buttons + short steps.
3. Polls `/deploy/status`: shows "Installation complete — your device is registered (pending
   approval)" once the device enrolls.
