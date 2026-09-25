# SecureEndpoint Manager

**An enterprise Device & Software Compliance + Workforce Productivity platform** — in the
same space as Microsoft Intune, ManageEngine Endpoint Central, JumpCloud and NinjaOne, with
an added employee productivity/attendance module and AI work-intelligence summaries.

It enrols Windows, Linux and macOS endpoints with a lightweight Go agent and enforces
company security policy: USB storage control, approved-software-only, antivirus/EDR, disk
encryption, firewall, patching and screen lock. Every device gets a 0–100 compliance score
and a risk level; alerts go out over email, SMS, WhatsApp, Slack, Teams or webhooks; and
every action lands in a tamper-evident audit trail. The optional **Workforce** module adds
attendance, active/idle and app/website tracking, task time, structured daily reports and
Claude-powered daily summaries — built privacy-first (no keystroke content, domains only,
opt-in blurred screenshots, visible tracking notice, employee self-view).

| | |
|---|---|
| **Backend** | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ (`backend/`) |
| **Console** | Next.js 15, React 19, Tailwind, TanStack Query (`frontend/`) |
| **Agent** | Go 1.23, one static binary per OS/arch (`agent/`) |
| **AI** | Claude (`@anthropic-ai/sdk`, `claude-opus-5`) — optional |
| **Delivery** | Docker Compose, Kubernetes (Kustomize), GitHub Actions, Nginx, Prometheus, Grafana |

> **Status:** working demo, verified module-by-module. Not yet hardened for production or
> tested as a full three-tier live run. See [Known issues & pending tasks](#known-issues--pending-tasks)
> before any real deployment — the Workforce module in particular requires HR/legal consent.

---

## Contents

- [Project overview](#project-overview)
- [Features & modules](#features--modules)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Installation & setup](#installation--setup)
- [Environment variables](#environment-variables)
- [Database migrations & seed](#database-migrations--seed)
- [Demo login credentials](#demo-login-credentials)
- [Folder structure](#folder-structure)
- [API overview](#api-overview)
- [Deployment guide](#deployment-guide)
- [Known issues & pending tasks](#known-issues--pending-tasks)
- [Roadmap](#roadmap)
- [License](#license)

---

## Project overview

SecureEndpoint Manager is a single console for security, IT and HR teams to:

- **Prove compliance** — score every managed device against a policy (encryption, AV/EDR,
  firewall, USB, patches, screen lock, approved software) and see fleet-wide posture live.
- **Enforce policy on the endpoint** — the Go agent applies USB blocking, software
  blacklisting, screen-lock and update settings, and runs remote commands.
- **Detect & alert** — a rule engine raises deduplicated alerts, delivered through your
  channels, with a hash-chained audit log you can verify.
- **Track work (optional)** — attendance, productivity and tasks per employee, with a
  privacy-preserving agent and AI-generated daily summaries.

Two agents in one binary: the **service** (SYSTEM/root) handles security telemetry and
enforcement; a **per-user helper** handles workforce activity in the signed-in session.

---

## Features & modules

### Core policy requirements

| # | Requirement | Where |
|---|---|---|
| 1 | Company data only on company-managed devices | enrolment, `NOT_COMPANY_DEVICE` rule |
| 2 | Block USB mass storage (whitelist + temporary access) | USB Control module + agent enforcement |
| 3 | Only approved software (discover, block, force-uninstall, licences) | Software module |
| 4 | Antivirus + EDR mandatory | Endpoint Security module |
| 5 | Full-disk encryption (BitLocker / FileVault / LUKS) | Endpoint Security |
| 6 | Host firewall enabled | Endpoint Security |
| 7 | Automatic OS/app updates & timely patching | Patch module |
| 8 | Screen lock + password on wake | policy + agent enforcement |
| 9 | Continuous monitoring, alerting & audit | Alerts + Audit + Reports |

### Modules

- **Device inventory & enrolment** — hardware/OS details, assignment, certificates, agent tokens.
- **Compliance engine** — 13 built-in rules, weighted 0–100 score, risk level, history.
- **USB control** — whitelist, temporary access requests/approvals, event log.
- **Software** — inventory, unauthorized/blacklisted detection, catalog, licences, force-uninstall.
- **Endpoint security** — AV, EDR, firewall, disk encryption, Secure Boot posture.
- **Patch management** — missing/critical patches, CVEs, deploy.
- **Alerting** — Email, SMS, WhatsApp (Twilio), Slack, Teams, generic webhook (HMAC-signed).
- **Audit** — append-only, SHA-256 hash chain, `/audit/verify`, CSV export.
- **Reporting** — Compliance / Device / Software / Security / Audit / USB / Patch → PDF, Excel, CSV.
- **Dashboard** — fleet KPIs, compliance trend, risk & platform breakdowns, top violations.
- **Workforce (optional)** — live board, attendance + monthly sheet + export, app/website
  productivity tracking, tasks & timers (allocated vs actual), structured daily reports,
  analytics, opt-in screenshots, and **AI work intelligence** (per-employee & management summaries).

### Authentication & access

RBAC with 8 roles (Super Admin, Security Admin, Compliance Officer, IT Admin, Department
Manager, Employee, Auditor, HR Manager), local login, LDAP/Active Directory, Azure AD &
generic OIDC SSO, TOTP MFA + recovery codes, rotating refresh tokens with reuse detection,
session management, IP restrictions.

---

## Architecture

```
                         ┌──────────────── Nginx (TLS, rate limits, headers) ────────────────┐
   Browser ──HTTPS──────►│  /            → Next.js console (frontend)                          │
                         │  /api/v1      → NestJS API (backend)                                │
   Endpoints ──HTTPS────►│  /api/v1/agent→ NestJS API (agent protocol, optional mTLS)          │
                         │  /downloads   → agent binaries + browser extension                  │
                         └───────────────────────────────────────────────────────────────────┘
                                   │                    │                    │
                            ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
                            │  API (web)  │      │   Worker    │      │  PostgreSQL │
                            │  NestJS     │      │  BullMQ     │◄────►│   Redis     │
                            └─────────────┘      └─────────────┘      └─────────────┘
                                   ▲  compliance eval · alerts · reports · nightly close · AI batch
                                   │
   ┌───────────────────────────────┴──────────────── Endpoint (Go agent) ───────────────────┐
   │  service (SYSTEM/root): inventory, security posture, USB/software enforcement, commands  │
   │  user-helper (session): activity, app/website (browser ext), opt-in blurred screenshots │
   └─────────────────────────────────────────────────────────────────────────────────────────┘
```

Detailed diagrams and sequence flows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Tech stack

**Frontend:** Next.js 15 (App Router, standalone), React 19, TypeScript, Tailwind CSS,
Radix UI + shadcn-style components, TanStack Query & Table, Recharts, react-hook-form + Zod.

**Backend:** NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ, Passport/JWT, argon2,
otplib, `@anthropic-ai/sdk`, PDFKit, ExcelJS, prom-client, Swagger.

**Agent:** Go 1.23 (`CGO_ENABLED=0`), `kardianos/service`, WMI/GDI (Windows), `go-winio` (IPC).

**Infra:** Docker & Docker Compose, Kubernetes (Kustomize), Nginx, Prometheus, Grafana,
GitHub Actions (CI, CodeQL, release, deploy).

---

## Installation & setup

**Prerequisites:** Docker with Compose v2, plus `bash` + `openssl` (Git Bash or WSL on Windows).

```bash
git clone https://github.com/sanjeevkumaraular01-png/device-compliance-platform.git
cd device-compliance-platform

./scripts/generate-secrets.sh        # Windows: .\scripts\generate-secrets.ps1  → writes .env with strong secrets
./scripts/gen-self-signed-cert.sh    # local TLS cert for https://localhost

docker compose up -d --build         # first build takes a few minutes
docker compose ps                    # wait until backend, frontend, nginx are healthy
```

Open **https://localhost** and accept the self-signed certificate warning, then log in with the
[demo credentials](#demo-login-credentials).

Optional monitoring stack (Prometheus, Grafana, exporters):

```bash
docker compose --profile monitoring up -d      # Grafana on http://127.0.0.1:3001 (set GRAFANA_PORT to change)
```

### Local development (without Docker)

```bash
# Postgres + Redis for dev
docker compose -f docker-compose.dev.yml up -d postgres redis

# Backend
cd backend && npm install && npx prisma migrate dev && npm run seed && npm run start:dev   # :4000

# Frontend (new terminal)
cd frontend && npm install && npm run dev                                                   # :3000
```

---

## Environment variables

Everything is configured via env vars; `.env.example` documents all ~73 of them with
comments, and `docs/ENVIRONMENT.md` has the full reference. Generate a ready `.env` with
`./scripts/generate-secrets.sh`. Key ones:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `REDIS_URL` | ✔ | Redis connection (BullMQ + caches) |
| `JWT_ACCESS_SECRET` | ✔ | JWT signing secret (≥ 32 chars) |
| `ENCRYPTION_KEY` | ✔ | AES-256-GCM key, base64 of 32 bytes (encrypts MFA secrets, channel configs, licence keys, screenshots) |
| `CORS_ORIGINS`, `WEB_URL`, `API_PUBLIC_URL` | ✔ | URLs / allowed origins |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | | first Super Admin |
| `SEED_DEMO_DATA` | | seed demo devices/users/workforce data (`true` in dev, **`false` in prod**) |
| `ANTHROPIC_API_KEY` | | enables AI work-intelligence summaries (off when unset) |
| `AI_MODEL`, `AI_EFFORT`, `AI_DAILY_RUN_TIME` | | AI tuning (defaults `claude-opus-5`, `high`, `20:30`) |
| `SMTP_*`, `TWILIO_*` | | email / SMS / WhatsApp alert delivery |
| `LDAP_*`, `AZURE_AD_*`, `OIDC_*` | | directory & SSO login |
| `SCREENSHOTS_DIR`, `WORKFORCE_TIMEZONE` | | workforce storage & timezone |
| `POSTGRES_*`, `REDIS_PASSWORD`, `GRAFANA_*` | | Docker Compose infra credentials |

> Optional features degrade gracefully: with SSO/LDAP/SMTP/Twilio/AI unset, those features
> are simply disabled (the login page even hides the Directory tab when LDAP is off).

---

## Database migrations & seed

Prisma owns the schema (`backend/prisma/schema.prisma`). In Docker the entrypoint runs
migrations and the seed automatically (`RUN_MIGRATIONS`, `RUN_SEED`). Manually:

```bash
cd backend
npx prisma migrate dev --name <name>    # create + apply a migration (dev)
npx prisma migrate deploy               # apply committed migrations (prod/CI)
npm run seed                            # idempotent seed (roles, policies, rules, catalog, demo data)
npx prisma studio                       # inspect the DB in a browser
```

The seed is idempotent (safe to run repeatedly). Demo data (guarded by `SEED_DEMO_DATA`)
adds ~60 devices, ~30+ employees, compliance history, USB/software/patch data, workforce
sessions/tasks/reports and sample AI insights.

---

## Demo login credentials

Available when `SEED_DEMO_DATA=true`. All use password **`ChangeMe!Secure2026`**, at
`@secureendpoint.local`:

| Role | Email |
|---|---|
| Super Admin | `admin@secureendpoint.local` |
| Security Admin | `secadmin@secureendpoint.local` |
| Compliance Officer | `compliance@secureendpoint.local` |
| IT Admin | `itadmin@secureendpoint.local` |
| Department Manager (Engineering) | `manager@secureendpoint.local` |
| Employee | `employee@secureendpoint.local` |
| Auditor | `auditor@secureendpoint.local` |
| HR Manager (Workforce) | `hr@secureendpoint.local` |

> Super Admin and Security Admin are prompted to set up MFA on first login. **Change the
> admin password and disable demo data before production.**

---

## Folder structure

```
.
├── backend/                 NestJS API + worker
│   ├── prisma/              schema, migrations, seed
│   └── src/                 auth, devices, compliance, usb, software, security, patches,
│                            alerts, audit, reports, dashboard, agent, workforce, tasks,
│                            daily-reports, ai, jobs, metrics, common, config …
├── frontend/                Next.js console
│   └── src/app, components, lib, types
├── agent/                   Go endpoint agent
│   ├── cmd/sem-agent/       CLI entry point
│   ├── internal/            collector, security, usb, software, enforce, commands,
│   │                        activity (workforce), ipc, api, pki, service …
│   └── packaging/           installers (win/linux/macos) + browser-extension
├── deploy/                  nginx, prometheus, grafana, k8s (Kustomize base + overlays)
├── docs/                    API, ARCHITECTURE, DEPLOYMENT, SECURITY, WORKFORCE, RUNBOOK, …
├── scripts/                 secret/cert generation, infra validation
├── docker-compose.yml       production-like stack
├── docker-compose.dev.yml   dev overrides (exposed DB/Redis, mail/LDAP test services)
└── Makefile                 up, down, logs, dev, build, test, seed, secrets, k8s-render
```

---

## API overview

REST API under `/api/v1`, Swagger UI at `/api/docs`. Full contract in
[`docs/API.md`](docs/API.md) and [`docs/WORKFORCE.md`](docs/WORKFORCE.md).

| Area | Base path |
|---|---|
| Auth (login, LDAP, SSO, MFA, sessions, `/auth/methods`) | `/auth` |
| Dashboard KPIs & trends | `/dashboard` |
| Devices, enrolment, commands | `/devices`, `/enrollment` |
| Policies & compliance | `/policies`, `/compliance` |
| Software, USB, security, patches | `/software`, `/usb`, `/security`, `/patches` |
| Alerts & channels | `/alerts` |
| Audit & reports | `/audit`, `/reports` |
| Users, roles, departments, settings | `/users`, `/roles`, `/departments`, `/settings` |
| Agent protocol | `/agent/*` (enroll, heartbeat, report, usb-events, activity, screenshots, …) |
| Workforce, tasks, daily reports, AI | `/workforce`, `/tasks`, `/daily-reports`, `/ai` |

Console users authenticate with `Authorization: Bearer <JWT>`; agents use a hashed agent
token plus `X-Device-Id`. Prometheus metrics are scraped internally at `backend:4000/metrics`.

---

## Deployment guide

Full guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Summary:

**Docker Compose (single host):** point DNS at the host, drop real TLS certs in
`deploy/nginx/certs/` (or use Let's Encrypt), set production values in `.env`
(`SEED_DEMO_DATA=false`, strong `SEED_ADMIN_PASSWORD`, real SMTP/SSO), then
`docker compose up -d`. Services run api + worker separately (`APP_ROLE`), with health checks
and a shared `/data` volume for reports, the device CA and screenshots.

**Kubernetes:** `deploy/k8s/` is Kustomize with `base/` + `overlays/staging|production`
(Deployments with HPA/PDB, hardened securityContext, Ingress with cert-manager,
NetworkPolicies, a migration Job, RWX PVC, ServiceMonitor/PrometheusRule). Use a **managed**
PostgreSQL and Redis in production. Render with `kubectl kustomize deploy/k8s/overlays/production`.

**CI/CD:** GitHub Actions in `.github/workflows/` — `ci` (lint/test/build all three parts +
Trivy), `codeql`, `release` (multi-arch images to GHCR, SBOM, cosign), `deploy`
(environment-gated kubectl apply + smoke test + rollback).

**First-login hardening:** rotate the admin password, enable MFA, configure IP restrictions,
set up SSO/LDAP, replace the self-signed cert. See `docs/SECURITY.md` and `docs/RUNBOOK.md`.

---

## Known issues & pending tasks

- **Not a full live integration test yet.** Each part passes its own tests (backend 152 unit
  + 17 e2e, agent tests on 3 OSes, frontend build), and the demo runs end-to-end in the
  browser, but a full scripted three-tier run is still pending.
- **Still demo-grade security out of the box:** self-signed cert, default admin password,
  MFA not enforced, demo data on. Harden before production.
- **AI features need an `ANTHROPIC_API_KEY`.** Until set, AI summaries are disabled (rest works).
- **Workforce "live" data needs a real agent** on at least one PC; demo data shows history only.
- **Screenshot blur is trusted from the agent** — the server cannot re-verify an image is blurred.
- **Long-running task timers are not auto-closed at midnight;** no holiday calendar yet.
- **Employee monitoring rollout requires HR/legal consent** (e.g. India's DPDP Act, GDPR).
  Deploy the Workforce agent only on company-owned devices with written notice/consent.
- The `main` history was rewritten once pre-first-push to scrub a placeholder Slack webhook
  from the seed; if you cloned an earlier state, re-clone.

---

## Roadmap

- [ ] Full three-tier live integration + end-to-end test suite in CI
- [ ] Production hardening pass (secrets, TLS, MFA enforcement, image scanning gates)
- [ ] MSI / signed installers for mass Windows rollout (GPO / Intune / SCCM)
- [ ] Agent auto-update channel
- [ ] Live remote-command console (WebSocket) and real-time device shell
- [ ] Server-side screenshot blur verification + configurable redaction zones
- [ ] Holiday calendar, shift schedules and leave workflow for attendance
- [ ] HRMS/payroll connectors (beyond the generic webhook)
- [ ] Vulnerability feed enrichment (CVE → CVSS/EPSS) and patch SLAs
- [ ] Multi-tenancy for MSP / multi-company deployments
- [ ] S3-compatible object storage for reports & screenshots

---

## License

Proprietary — see [`LICENSE`](LICENSE). Internal/authorized use only.

---

Built with [Claude Code](https://claude.com/claude-code).
