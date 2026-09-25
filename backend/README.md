# SecureEndpoint Manager — Backend

NestJS 11 + Prisma 6 (PostgreSQL 16) + Redis 7 / BullMQ backend for the SecureEndpoint
Manager device & software compliance platform. Implements the REST API and agent protocol
defined in [`../docs/API.md`](../docs/API.md).

- API base: `http://localhost:4000/api/v1`
- Swagger UI: `/api/docs` (JSON: `/api/docs-json`)
- Health: `/api/v1/health` (liveness), `/api/v1/health/ready` (DB + Redis)
- Prometheus: `/metrics` (outside the `/api/v1` prefix)

## Module map

| Module | Path | Responsibility |
|---|---|---|
| config | `src/config` | Joi-validated env (`env.validation.ts`), typed `AppConfigService`, `APP_ROLE` resolution (`role.ts`) |
| prisma / redis / queues | `src/prisma`, `src/redis`, `src/queues` | PrismaService, ioredis client + JSON cache, BullMQ queues `alerts`, `reports`, `compliance`, `maintenance` |
| common | `src/common` | Global guards (Throttler → IP restriction → JWT → permissions), `AgentAuthGuard`, decorators (`@Public`, `@RequirePermissions`, `@AgentAuth`, `@CurrentUser`, `@CurrentDevice`), AES-256-GCM `CryptoService`, pagination helpers, contract error filter, request-id/async-context middleware, audit interceptor, row scoping (`scope.ts`), CIDR matching, CSV |
| auth | `src/auth` | Local login (argon2id), lockout (5 failures → 15 min), password policy, TOTP MFA + recovery codes, refresh-token rotation (opaque `sem_rt_…`, SHA-256 hashed), sessions + idle timeout, LDAP/AD (`ldapts`), Azure AD + generic OIDC SSO (`openid-client`), login history |
| users / roles / departments | `src/users`, `src/roles`, `src/departments` | Directory management, editable role→permission matrix |
| devices | `src/devices` | Inventory, assignment history, commands, quarantine/release, retire, timeline, per-device sub-resources |
| enrollment | `src/enrollment` | Enrollment tokens (`sem_enr_…`), install one-liners, pending approval, internal device CA (`ca.service.ts`, auto-generated RSA-3072 CA; signs RSA agent CSRs) |
| agent | `src/agent` | `/agent/*` protocol: enroll, heartbeat (command delivery), full state report (inventory reconciliation, classification, patches, evaluation), USB & software events, command results, policy |
| policies | `src/policies` | Policy CRUD, versioning + `APPLY_POLICY` propagation, resolution device → department → default, `AgentPolicy` builder |
| compliance | `src/compliance` | Pure rule engine `compliance.engine.ts` (`evaluate(device, security, software, patches, policy, rules)`), results/history/summary, alert raise + auto-resolve, BullMQ evaluation processor |
| software | `src/software` | Pure classifier `software.classifier.ts`, aggregated inventory, whitelist/blacklist, licenses, uninstall, reclassify |
| usb / security / patches | `src/usb`, `src/security`, `src/patches` | USB whitelist/events/temporary access, protection overview, patch aggregation / vulnerabilities / deploy |
| alerts | `src/alerts` | Deduplicated alerts, channels (EMAIL/SMS/WHATSAPP/SLACK/TEAMS/WEBHOOK, encrypted config, masked output), BullMQ delivery with retries/backoff |
| audit | `src/audit` | Append-only SHA-256 hash chain (`audit-chain.ts`, serialized with `pg_advisory_xact_lock`), verify, CSV export, login history |
| reports | `src/reports` | BullMQ report generation (PDF via pdfkit, XLSX via exceljs, CSV) for COMPLIANCE/DEVICE/SOFTWARE/SECURITY/AUDIT/USB/PATCH, cron schedules (BullMQ job schedulers) with e-mail delivery |
| dashboard | `src/dashboard` | Summary KPIs, 30-day trend, top violations, department compliance |
| settings | `src/settings` | System settings (`sessionTimeoutMinutes`, `mfaRequiredRoles`, …) and IP allow-list (CIDR, cached 30 s) |
| metrics / health | `src/metrics`, `src/health` | `sem_*` Prometheus metrics (gauges refreshed every 60 s), liveness/readiness |
| jobs | `src/jobs` | Worker schedulers: mark inactive devices, expire USB temporary access (+ `REFRESH_USB_RULES`), expire commands (every 5 min); nightly re-evaluation; warranty refresh; report purge |

### Process roles (`APP_ROLE`)

- `all` (default): HTTP API + BullMQ processors + schedulers.
- `api`: HTTP API only (queues are produced, not consumed — run at least one `worker`).
- `worker`: BullMQ processors + schedulers; HTTP serves only `/api/v1/health*` and `/metrics` on `PORT`.

## Running locally

```bash
# 1. dependencies
docker run -d --name sem-pg -e POSTGRES_USER=sem -e POSTGRES_PASSWORD=sem -e POSTGRES_DB=sem -p 5432:5432 postgres:16-alpine
docker run -d --name sem-redis -p 6379:6379 redis:7-alpine

# 2. configure
cp .env.example .env    # set JWT_ACCESS_SECRET and ENCRYPTION_KEY (see comments)

# 3. install, migrate, seed, run
npm install
npm run prisma:deploy     # or: npm run prisma:migrate (dev)
npm run seed              # idempotent; demo data when SEED_DEMO_DATA=true
npm run start:dev         # or: npm run build && npm run start:prod
```

### Demo credentials (seed)

All demo users share `SEED_ADMIN_PASSWORD` (default `ChangeMe!Secure2026`):

| Role | Email |
|---|---|
| SUPER_ADMIN | `admin@secureendpoint.local` |
| SECURITY_ADMIN | `secadmin@secureendpoint.local` |
| COMPLIANCE_OFFICER | `compliance@secureendpoint.local` |
| IT_ADMIN | `itadmin@secureendpoint.local` |
| DEPARTMENT_MANAGER (Engineering) | `manager@secureendpoint.local` |
| EMPLOYEE (Engineering) | `employee@secureendpoint.local` |
| AUDITOR | `auditor@secureendpoint.local` |

SUPER_ADMIN and SECURITY_ADMIN are in `SECURITY_MFA_REQUIRED_ROLES`: login succeeds but returns
`X-MFA-Enrollment-Required: true` until MFA is enrolled.

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | `prisma generate` + `nest build` (→ `dist/main.js`) + compile seed (→ `dist/prisma/seed.js`) |
| `npm run start:dev` / `start:prod` | watch mode / `node dist/main.js` |
| `npm run lint` | ESLint (flat config) |
| `npm test` | unit tests (compliance engine, classifier, audit chain, crypto, permissions guard, CIDR) |
| `npm run test:e2e` | boots the app against `DATABASE_URL`/`REDIS_URL` (migrated + seeded): login → devices → agent enroll → report → compliance |
| `npm run prisma:migrate` / `prisma:deploy` | `prisma migrate dev` / `prisma migrate deploy` |
| `npm run seed` / `seed:prod` | ts-node seed / compiled seed |

## Docker

```bash
docker build -t sem-backend .
docker run --env-file .env -p 4000:4000 -v sem-data:/app/data sem-backend
```

The image is multi-stage (`node:22-alpine`), runs as the non-root `node` user, and has a
`HEALTHCHECK` on `/api/v1/health`. `docker-entrypoint.sh` runs `prisma migrate deploy` when
`RUN_MIGRATIONS=true`, the compiled seed when `RUN_SEED=true`, then `exec node dist/main.js`.
Persist `/app/data` (reports + device CA key). In a split deployment run one container with
`APP_ROLE=api` and one or more with `APP_ROLE=worker` (set `RUN_MIGRATIONS/RUN_SEED=false` on workers).

## Security notes

- Helmet, CORS allow-list (`CORS_ORIGINS`), global rate limit plus stricter limit on `/auth/*`.
- `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform` (agent payloads strip unknown
  fields instead of rejecting them, for forward compatibility).
- JWT (HS256, 15 min) carries `sid`; every request checks the session is not revoked / idle (cached in Redis 30 s).
- Tokens (refresh, agent, enrollment) are random secrets stored as SHA-256 and compared with `timingSafeEqual`.
- MFA secrets, license keys and alert-channel configs are AES-256-GCM encrypted with `ENCRYPTION_KEY`;
  channel configs are returned masked.
- IP allow-list (CIDR, IPv4/IPv6) applies to console routes; agent, health, metrics and CA download are exempt.
- Every mutating action is written to the tamper-evident audit chain; `GET /api/v1/audit/verify` re-hashes it.
- Logs are JSON (pino) with authorization headers, cookies and token fields redacted.
