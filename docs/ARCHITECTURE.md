# Architecture

SecureEndpoint Manager is a single-tenant platform for device and software compliance. The endpoint agents collect state, the backend enforces policy, and the web console lets operators administer the fleet. This document describes the components, how data moves between them, the main interaction sequences, the data model and the scaling model.

- API contract: [API.md](API.md)
- Security controls: [SECURITY.md](SECURITY.md)
- Compliance rules and scoring: [COMPLIANCE-ENGINE.md](COMPLIANCE-ENGINE.md)
- Deployment: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 1. Components

```mermaid
flowchart LR
    subgraph Endpoints["Managed endpoints"]
        W["Windows agent<br/>sem-agent (Go service)"]
        L["Linux agent"]
        M["macOS agent"]
    end

    subgraph Edge["Edge (TLS termination)"]
        NGX["Nginx / ingress-nginx<br/>TLS 1.2/1.3, HSTS, CSP<br/>rate limits, optional mTLS"]
        DL["/downloads/<br/>agent binaries + install scripts"]
    end

    subgraph App["Application tier"]
        FE["frontend<br/>Next.js console :3000"]
        API["backend APP_ROLE=api<br/>NestJS :4000 /api/v1"]
        WRK["backend APP_ROLE=worker<br/>BullMQ processors + schedulers"]
    end

    subgraph Data["Data tier (internal network)"]
        PG[("PostgreSQL 16")]
        RD[("Redis 7<br/>queues, rate limits")]
        FS[("/data volume<br/>reports + internal CA")]
    end

    subgraph Ext["External services"]
        IDP["Entra ID / OIDC / LDAP-AD"]
        NOTIF["SMTP, Twilio SMS/WhatsApp,<br/>Slack, Teams, webhooks"]
    end

    subgraph Obs["Observability (optional)"]
        PROM["Prometheus + Alertmanager"]
        GRAF["Grafana"]
    end

    Browser(("Admin browser")) -->|HTTPS| NGX
    W & L & M -->|"HTTPS /api/v1/agent/*<br/>Bearer agentToken + X-Device-Id"| NGX
    W & L & M -.->|install| DL
    NGX -->|"/"| FE
    NGX -->|"/api/"| API
    NGX --- DL
    FE -->|"SSR rewrites /api/*"| API
    API --> PG
    API --> RD
    API --> FS
    WRK --> PG
    WRK --> RD
    WRK --> FS
    API --> IDP
    WRK --> NOTIF
    PROM -->|"/metrics"| API
    PROM -->|"/metrics"| WRK
    GRAF --> PROM
```

| Component | Technology | Responsibilities | Scales |
|---|---|---|---|
| **Agent** | Go 1.23, one static binary per OS/arch, runs as a system service | Enrollment with a CSR, heartbeat, full state reports (hardware, security posture, software, patches), USB and software event streaming, local enforcement (USB blocking, uninstall, patching, screen lock), command execution | One per endpoint |
| **Nginx / Ingress** | nginx 1.27 or ingress-nginx | TLS, HTTP to HTTPS redirect, security headers, per-zone rate limits, optional agent mTLS, static `/downloads/`, blocking `/metrics` from outside | Horizontally |
| **frontend** | Next.js (standalone), React 19, TanStack Query | Admin console. The browser calls the relative path `/api/v1`, and Next rewrites `/api/*` to `http://backend:4000` for server-side calls | Stateless, HPA |
| **backend (api)** | NestJS 11, Prisma 6, argon2, JWT, prom-client | REST API, authentication (local, LDAP, SSO, MFA), RBAC and row scoping, agent protocol, audit hash chain, enqueuing work | Stateless, HPA (at least 3) |
| **backend (worker)** | Same image, `APP_ROLE=worker`, BullMQ | Queue processors for `compliance`, `reports`, `alerts` and `maintenance`. Schedulers for periodic re-evaluation, scheduled reports, USB access expiry, command expiry and data retention | HPA on CPU and memory, at least 2 |
| **PostgreSQL** | 16 | System of record (see §6) | Vertical, plus read replicas or managed HA |
| **Redis** | 7, AOF, `noeviction` | BullMQ queues, distributed rate-limit counters, short-lived caches | Vertical, or a managed service |
| **/data volume** | Docker volume `app-data`, or RWX PVC `sem-data` | `/data/reports` (report files the worker writes and the api streams) and `/data/pki` (internal device CA) | Shared (RWX) |
| **agent-dist** | One-shot image | Copies `sem-agent-*`, `install.ps1`, `install.sh`, `install-macos.sh` and `checksums.txt` into the `downloads` volume or `emptyDir` | Runs at deploy time |

The api and the worker are the **same image** with different `APP_ROLE` values. Both expose `/api/v1/health`, `/api/v1/health/ready` and `/metrics` on port 4000, so the same probes and scrape configs work for both.

---

## 2. Data flow

The main pipeline runs from agent telemetry to a compliance decision to notifications:

```mermaid
flowchart LR
    A["Agent<br/>POST /agent/report"] --> B["API: AgentController<br/>validate token, upsert<br/>inventory / security / patches"]
    B --> C["Software classifier<br/>blacklist → whitelist → policy"]
    C --> D["Compliance engine<br/>evaluate rules against<br/>effective policy"]
    B -. "bulk / scheduled" .-> Q[["BullMQ queue<br/>compliance"]]
    Q --> D
    D --> E[("compliance_results<br/>devices.compliance_*")]
    D --> F{"State changed to NON_COMPLIANT<br/>or new CRITICAL finding?"}
    F -->|yes| G[("alerts<br/>dedupeKey compliance:device:rule")]
    G --> H[["BullMQ queue<br/>alerts"]]
    H --> I["Channel dispatcher<br/>minSeverity + categories"]
    I --> J["Email / SMS / WhatsApp /<br/>Slack / Teams / Webhook"]
    I --> K[("alert_deliveries")]
    B --> L[("audit_logs<br/>hash chain")]
    D --> M["Response to agent:<br/>state, score, risk, findings"]
```

1. **Collection.** The agent sends `POST /agent/heartbeat` every `checkinIntervalSec` (default 300 s) and `POST /agent/report` every `inventoryIntervalSec` (default 3600 s) or whenever local state changes. USB and software events are streamed as they happen.
2. **Ingestion.** The api authenticates the agent (SHA-256 of the bearer token must match `devices.agent_token_hash` for `X-Device-Id`). It upserts `security_status`, `software_inventory` and `patch_status`, marks software that was not reported as removed, and writes audit entries for installs and removals.
3. **Classification.** Each software item is classified as `APPROVED`, `UNAUTHORIZED`, `BLACKLISTED` or `UNKNOWN` (see [COMPLIANCE-ENGINE.md](COMPLIANCE-ENGINE.md)).
4. **Evaluation.** Reports are evaluated inline so the agent receives its current state in the response. Bulk re-evaluations (policy change, rule change, `POST /compliance/evaluate`, schedulers) go through the `compliance` queue on the workers.
5. **Alerting.** Transitions to `NON_COMPLIANT` or new CRITICAL findings raise deduplicated alerts. Blocked USB events raise USB alerts. The `alerts` queue fans each alert out to every enabled channel whose `minSeverity` and `categories` match, and records every attempt in `alert_deliveries`.
6. **Enforcement.** The policy itself goes to the agent (`AgentPolicy`, versioned). Remediation goes as commands (`UNINSTALL_SOFTWARE`, `INSTALL_PATCHES`, `APPLY_POLICY`, `REFRESH_USB_RULES`, `LOCK_SCREEN`, …) that the agent picks up on its next heartbeat.

---

## 3. Key sequences

### 3.1 Enrollment

```mermaid
sequenceDiagram
    autonumber
    actor IT as IT Admin
    participant C as Console
    participant API as backend (api)
    participant DB as PostgreSQL
    participant CA as Internal CA (/data/pki)
    participant A as Agent (endpoint)

    IT->>C: Create enrollment token (name, platform, department, policy, maxUses, expiry, autoApprove)
    C->>API: POST /enrollment/tokens
    API->>DB: store SHA-256(token), prefix, limits
    API-->>C: sem_enr_… (shown once)
    C->>API: GET /enrollment/install-command?tokenId&platform
    API-->>C: one-liner (PowerShell / bash / zsh) + downloadUrl
    IT->>A: Run one-liner (manually, Intune, GPO, SCCM, Jamf, Ansible…)
    A->>A: download /downloads/sem-agent-<os>-<arch>, verify checksums.txt
    A->>A: generate RSA-2048 key + CSR (private key never leaves device)
    A->>API: POST /agent/enroll {enrollmentToken, csrPem, agentVersion, hardware}
    API->>DB: validate token (hash, not revoked/expired, usedCount < maxUses)
    API->>DB: upsert device by serialNumber (re-enroll rotates credentials)
    API->>CA: sign CSR → device certificate
    API->>DB: store SHA-256(agentToken), device_certificates(fingerprint)
    API->>DB: audit_logs (DEVICE_CHANGE, device.enroll)
    API-->>A: 201 {deviceId, agentToken sem_agt_…, status ACTIVE|PENDING, certificatePem, caCertificatePem, policy, checkinIntervalSec}
    alt autoApprove = false
        IT->>C: Review pending devices
        C->>API: POST /enrollment/devices/:id/approve (or /reject)
    end
```

### 3.2 Check-in (heartbeat) and command delivery

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant N as Nginx
    participant API as backend (api)
    participant DB as PostgreSQL

    loop every checkinIntervalSec (default 300 s)
        A->>N: POST /api/v1/agent/heartbeat {agentVersion, uptimeSec, loggedInUser}<br/>Bearer sem_agt_… + X-Device-Id (+ client cert if mTLS)
        N->>N: rate limit per X-Device-Id, optional ssl_verify_client
        N->>API: forward (+ X-SSL-Client-Fingerprint / Verify)
        API->>DB: verify token hash for device, status not RETIRED
        API->>DB: devices.last_seen_at = now(), agent_version
        API->>DB: select PENDING, non-expired device_commands → mark SENT
        API-->>A: {policy, policyVersion, commands[], serverTime}
        opt policyVersion changed
            A->>A: apply AgentPolicy (USB rules, screen lock, updates…)
        end
        loop each command
            A->>A: execute (UNINSTALL_SOFTWARE, INSTALL_PATCHES, LOCK_SCREEN…)
            A->>API: POST /agent/commands/:id/result {status, output, error, data}
            API->>DB: device_commands SUCCEEDED/FAILED, audit
        end
    end
```

### 3.3 Compliance evaluation

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant API as backend (api)
    participant Q as Redis / BullMQ
    participant W as backend (worker)
    participant DB as PostgreSQL
    participant CH as Alert channels

    A->>API: POST /agent/report {hardware, security, software[], patches[]}
    API->>DB: upsert security_status, software_inventory, patch_status
    API->>API: classify software (blacklist → whitelist → policy)
    API->>DB: resolve effective policy (device → department → default)
    API->>API: evaluate enabled compliance_rules → findings, score, state, risk
    API->>DB: insert compliance_results, update devices.compliance_state/score/risk_level
    alt became NON_COMPLIANT or new CRITICAL finding
        API->>DB: upsert alerts (dedupeKey = compliance:<deviceId>:<ruleKey>)
        API->>Q: enqueue alerts job
    end
    alt rule now passes
        API->>DB: auto-resolve matching open alert
    end
    API-->>A: {complianceState, complianceScore, riskLevel, findings[]}

    Note over API,W: Bulk path: PATCH /policies/:id, PATCH /compliance/rules/:id,<br/>POST /compliance/evaluate and schedulers enqueue "compliance" jobs
    Q->>W: compliance job (deviceIds)
    W->>DB: same evaluation per device
    Q->>W: alerts job
    W->>DB: select enabled channels matching severity/category
    W->>CH: deliver (SMTP / Twilio / Slack / Teams / webhook HMAC)
    W->>DB: alert_deliveries (SENT / FAILED, attempts)
```

### 3.4 USB temporary access approval

```mermaid
sequenceDiagram
    autonumber
    actor E as Employee
    actor MGR as Approver (usb:approve)
    participant A as Agent
    participant API as backend (api)
    participant DB as PostgreSQL
    participant W as worker (scheduler)

    E->>A: plug in USB storage
    A->>A: policy.usb.blockStorage → block
    A->>API: POST /agent/usb-events [{eventType: BLOCKED, vendorId, productId, serialNumber…}]
    API->>DB: usb_events, usb_devices (lastSeen), alert (USB, MEDIUM, deduped per device+serial per hour)
    E->>API: POST /usb/requests {deviceId, vendorId, productId, serialNumber, reason, durationHours 1–72, readOnly}
    API->>DB: usb_access_requests (PENDING), audit
    API-->>MGR: notification via alert channels / console queue
    MGR->>API: POST /usb/requests/:id/approve {note, durationHours?}
    API->>DB: status APPROVED, approver, expiresAt = now + duration, audit
    API->>DB: device_commands REFRESH_USB_RULES
    A->>API: POST /agent/heartbeat
    API-->>A: commands [REFRESH_USB_RULES] + policy.usb.whitelist (with expiresAt)
    A->>A: allow that VID/PID/serial (read-only if requested) until expiresAt
    A->>API: POST /agent/usb-events [{eventType: ALLOWED}]
    W->>DB: on expiry: status EXPIRED, queue REFRESH_USB_RULES
    Note over MGR,API: POST /usb/requests/:id/revoke ends access early
```

### 3.5 Report generation

```mermaid
sequenceDiagram
    autonumber
    actor U as User (reports:create)
    participant API as backend (api)
    participant Q as BullMQ "reports"
    participant W as backend (worker)
    participant DB as PostgreSQL
    participant FS as /data/reports (shared)

    U->>API: POST /reports {type, format PDF|XLSX|CSV, parameters}
    API->>DB: reports (QUEUED), audit
    API->>Q: enqueue report job
    API-->>U: Report {status: QUEUED}
    Q->>W: job
    W->>DB: status RUNNING, startedAt
    W->>DB: query data (row-scoped to the requester's permissions)
    W->>FS: write file (pdfkit / exceljs / CSV)
    W->>DB: status COMPLETED, filePath, fileSize, rowCount (or FAILED + error)
    U->>API: GET /reports/:id (poll)
    U->>API: GET /reports/:id/download
    API->>FS: stream file (Content-Disposition)
    Note over W: ReportSchedule (cron) → worker scheduler enqueues the same job<br/>and emails the file to recipients via SMTP
```

---

## 4. Module map

The backend is a modular NestJS application. Each business module owns its controllers, services, DTOs and Prisma access. Cross-cutting concerns are global providers.

```mermaid
flowchart TB
    subgraph Core["Cross-cutting"]
        CFG[Config / env validation]
        PRISMA[Prisma service]
        CRYPTO["Crypto (AES-256-GCM, hashing)"]
        AUDIT[Audit hash chain]
        METRICS[Prometheus metrics]
        HEALTH[Health]
        QUEUE[BullMQ queues]
    end
    subgraph Identity
        AUTH["Auth: local, LDAP/AD, Azure AD, OIDC,<br/>MFA, sessions, refresh rotation"]
        USERS[Users / Roles / Departments]
        SETTINGS[Settings / IP restrictions]
    end
    subgraph Fleet
        DEV[Devices & assignments]
        ENR[Enrollment & PKI]
        AGENT[Agent protocol]
        POL[Policies]
    end
    subgraph Posture
        COMP[Compliance engine]
        SW[Software & licenses]
        USB[USB control]
        SEC[Security posture]
        PATCH[Patches & vulnerabilities]
    end
    subgraph Output
        ALERT[Alerts & channels]
        REP[Reports & schedules]
        DASH[Dashboard]
        AUD[Audit API]
    end
    AGENT --> DEV & SW & USB & SEC & PATCH & COMP
    COMP --> ALERT
    POL --> COMP
    SW --> COMP
    USB --> ALERT
    REP --> QUEUE
    ALERT --> QUEUE
    Identity --> AUDIT
    Fleet --> AUDIT
    Posture --> AUDIT
```

| # | Module | API prefix | Main tables | Queue |
|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | (aggregates) | – |
| 2 | Device inventory & assets | `/devices` | `devices`, `device_assignments`, `device_commands` | – |
| 3 | Enrollment & agent management | `/enrollment`, `/agent` | `enrollment_tokens`, `device_certificates` | – |
| 4 | Policy management | `/policies` | `device_policies` | compliance |
| 5 | Compliance engine | `/compliance` | `compliance_rules`, `compliance_results` | compliance |
| 6 | Software management | `/software` | `software_inventory`, `software_whitelist`, `software_blacklist` | compliance |
| 7 | USB device control | `/usb` | `usb_devices`, `usb_events`, `usb_access_requests` | maintenance (expiry) |
| 8 | Endpoint security posture | `/security` | `security_status` | – |
| 9 | Patch & vulnerability management | `/patches` | `patch_status` | – |
| 10 | Alerts & notifications | `/alerts` | `alerts`, `alert_channels`, `alert_deliveries` | alerts |
| 11 | Audit trail | `/audit` | `audit_logs`, `login_history` | – |
| 12 | Reports & scheduling | `/reports` | `reports`, `report_schedules` | reports |
| – | Identity & access | `/auth`, `/users`, `/roles`, `/departments`, `/settings` | `users`, `roles`, `sessions`, `departments`, `ip_restrictions`, `system_settings` | maintenance (cleanup) |

---

## 5. Request pipeline (api)

Every HTTP request passes through the same chain:

1. **Nginx.** TLS, rate limit zone (`sem_api`, `sem_auth`, `sem_agent`, `sem_enroll`), and an `X-Request-Id` header (created or propagated).
2. **Express and helmet.** Security headers and `trust proxy`, so the real client IP comes from `X-Forwarded-For`.
3. **Request logging** with pino, including the request ID. The HTTP metrics middleware records `sem_http_requests_total` and `sem_http_request_duration_seconds`.
4. **Throttler.** `RATE_LIMIT_*` limits, and `AUTH_RATE_LIMIT_MAX` for `/auth`. Counters must use shared (Redis) storage when the api runs more than one replica; otherwise each replica counts separately.
5. **IP restriction guard.** Applies to console routes only. Agent endpoints are exempt.
6. **Authentication guard.** Console routes take a JWT. Agent routes take the agent token plus `X-Device-Id`.
7. **Permission guard.** Checks the `resource:action` permissions from the role, then applies row scoping for DEPARTMENT_MANAGER and EMPLOYEE.
8. **Validation pipe.** class-validator on the DTOs, with whitelisting.
9. **Controller → service → Prisma.** State-changing actions write an `audit_logs` entry.
10. **Exception filter.** Produces the uniform error envelope `{statusCode, error, message, path, timestamp, requestId}`.

---

## 6. Data model

The PostgreSQL schema is defined in [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma). Tables are snake_case plurals and every primary key is a UUID, except `audit_logs`, which uses a `bigserial` so the hash chain has a stable order.

```mermaid
erDiagram
    roles ||--o{ users : "has"
    departments ||--o{ users : "members"
    users |o--o{ departments : "manages"
    users ||--o{ sessions : "has"
    users ||--o{ login_history : "logs"
    device_policies |o--o{ departments : "default for"
    device_policies |o--o{ devices : "assigned to"
    departments |o--o{ devices : "owns"
    users |o--o{ devices : "assigned user"
    devices ||--o{ device_assignments : "history"
    users ||--o{ device_assignments : "assignee"
    devices ||--o{ device_certificates : "issued"
    devices ||--o| security_status : "posture"
    devices ||--o{ software_inventory : "installed"
    devices ||--o{ patch_status : "patches"
    devices ||--o{ usb_events : "usb"
    usb_devices |o--o{ usb_events : "seen as"
    devices ||--o{ usb_access_requests : "requests"
    usb_devices |o--o{ usb_access_requests : "for"
    users ||--o{ usb_access_requests : "requester / approver"
    devices ||--o{ compliance_results : "evaluations"
    devices ||--o{ alerts : "raises"
    alerts ||--o{ alert_deliveries : "sent via"
    alert_channels ||--o{ alert_deliveries : "delivers"
    devices ||--o{ device_commands : "queued"
    users |o--o{ reports : "requested"

    devices {
        uuid id PK
        string serial_number UK
        string asset_id UK
        enum platform
        enum status
        enum compliance_state
        int compliance_score
        enum risk_level
        string agent_token_hash UK
        timestamp last_seen_at
    }
    device_policies {
        uuid id PK
        string name UK
        bool is_default
        int version
        bool usb_storage_blocked
        bool block_unauthorized_software
        bool require_disk_encryption
    }
    compliance_results {
        uuid id PK
        uuid device_id FK
        int score
        enum state
        enum risk_level
        json findings
        timestamp evaluated_at
    }
    alerts {
        uuid id PK
        enum category
        enum severity
        enum status
        string dedupe_key
        int occurrences
    }
    audit_logs {
        bigint id PK
        enum category
        string action
        string prev_hash
        string hash
    }
    users {
        uuid id PK
        string email UK
        enum auth_provider
        string password_hash
        bool mfa_enabled
        string mfa_secret_enc
    }
```

Other tables: `enrollment_tokens`, `compliance_rules`, `software_whitelist`, `software_blacklist`, `ip_restrictions`, `report_schedules` and `system_settings`.

**Data sensitivity**

| Class | Where | Protection |
|---|---|---|
| Credentials | `users.password_hash` (argon2id), `sessions.refresh_token_hash`, `devices.agent_token_hash`, `enrollment_tokens.token_hash` (SHA-256), `users.mfa_recovery_hashes` | Only hashes are stored |
| Secrets | `users.mfa_secret_enc`, `alert_channels.config_enc`, `software_whitelist.license_key_enc` | AES-256-GCM with `ENCRYPTION_KEY` |
| Personal data | users (email, phone), device assignment, logged-in user names, USB file paths | RBAC, row scoping, audit trail |
| Evidence | `audit_logs` (append-only hash chain), `login_history` | Tamper evidence via `GET /audit/verify` |

---

## 7. Scaling model

| Tier | Strategy | Notes |
|---|---|---|
| Agents | Jittered intervals (heartbeat 300 s, inventory 3600 s by default, tunable per policy) | 10 000 devices at 300 s is about 33 heartbeats/s plus about 3 reports/s |
| Nginx / Ingress | Horizontal | Keep-alive to upstreams. Agent rate limits are keyed per device, not per IP, because of NAT |
| api | Stateless and horizontal (HPA on CPU and memory, 3 to 20 replicas) | JWTs are verified locally. Sessions live in PostgreSQL. Shared state lives in PostgreSQL or Redis |
| worker | Horizontal. BullMQ distributes jobs, one job per worker slot | Scale on the `sem_queue_jobs{state="waiting"}` backlog (alert `SemQueueBacklog`). Each scheduled task must run once per interval no matter how many workers exist. BullMQ repeatable jobs (or a Redis lock) provide this |
| PostgreSQL | Vertical first, then managed HA with read replicas | The largest tables are `software_inventory`, `usb_events`, `audit_logs` and `compliance_results`. Plan retention (see [DEPLOYMENT.md](DEPLOYMENT.md#sizing)) |
| Redis | Vertical, or a managed service | Small dataset. `noeviction` is mandatory for BullMQ |
| /data | RWX shared file system | Report files are small to medium. Object storage (S3-compatible) is planned as future work |

For hardware sizing per fleet size, see [DEPLOYMENT.md, Sizing](DEPLOYMENT.md#sizing).

---

## 8. Multi-tenancy

SecureEndpoint Manager is **single-tenant by design**. One deployment serves one organisation, with one PostgreSQL database, one internal CA and one `ENCRYPTION_KEY`. Isolation *inside* an organisation comes from RBAC and row scoping: department managers see only their departments, and employees see only their own devices.

Managed service providers who serve several customers should run **one deployment per customer**. Use one Kubernetes namespace per customer (the overlays already change `namespace`), or separate clusters. Each deployment gets its own database, secrets, CA and hostname. This avoids cross-tenant data leakage by construction and allows per-customer upgrade windows, backups and data residency.

---

## 9. Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| API framework | NestJS 11 | Modular DI, guards and pipes fit RBAC and validation. Mature OpenAPI support |
| ORM | Prisma 6 | Type-safe queries, declarative migrations (`prisma migrate deploy`) |
| Queue | BullMQ on Redis | Reliable retries and back-off, repeatable jobs for schedulers |
| Agent | Go | Single static binary per OS and arch, no runtime dependencies, runs as a native service (`kardianos/service`) |
| Console | Next.js standalone | Small container, SSR, and the API rewrite keeps the browser on the same origin (no CORS) |
| Metrics | prom-client, Prometheus, Grafana | Industry standard. Dashboards and alerts ship in `deploy/` |
