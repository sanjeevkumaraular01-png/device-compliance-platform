# Environment Variables Reference

Every setting of SecureEndpoint Manager is supplied through environment variables.

| Deployment | Where values live |
|---|---|
| Docker Compose | `.env` at the repository root (template: [`.env.example`](../.env.example), generator: `scripts/generate-secrets.sh` / `.ps1`). `docker-compose.yml` maps them into each container explicitly. |
| Kubernetes | Non-secret values: ConfigMap `sem-config` (generated from [`deploy/k8s/base/config.env`](../deploy/k8s/base/config.env), merged per overlay). Secret values: Secret `sem-secrets` (template [`secret.example.yaml`](../deploy/k8s/base/secret.example.yaml)), created out of band or through External Secrets / Sealed Secrets. |

**Legend**

- **Req.**: **yes** means the backend refuses to start without it. **cond.** means it is required only when the feature is used.
- **Secret**: **S** means keep it in `.env` or the Kubernetes Secret. Never put it in a ConfigMap, a CI log or a ticket.
- **Used by**: **api** is the backend with `APP_ROLE=api`, **worker** is `APP_ROLE=worker`, **compose** is `docker-compose.yml` only, and **fe-build** is the frontend image build.

Generate secret values with:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY (exactly 32 bytes -> 44 base64 chars)
openssl rand -base64 48   # JWT_ACCESS_SECRET (>= 32 chars)
openssl rand -hex 24      # URL-safe passwords (Postgres, Redis, Grafana)
```

---

## 1. Runtime & process

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `NODE_ENV` | no | `production` | | api, worker | `production`, `development` or `test`. Always use `production` outside local development. |
| `PORT` | no | `4000` | | api, worker | HTTP port. The worker also listens on it for `/api/v1/health` and `/metrics`. |
| `APP_ROLE` | no | `all` | | api, worker | `api` serves HTTP only. `worker` runs BullMQ processors and schedulers for the `compliance`, `reports`, `alerts` and `maintenance` queues. `all` runs both in one process, for development only. Compose and Kubernetes set this for each service. |
| `LOG_LEVEL` | no | `info` | | api, worker | `fatal`, `error`, `warn`, `info`, `debug` or `trace` (pino). |
| `RUN_MIGRATIONS` | no | `false` | | api | The entrypoint runs `prisma migrate deploy` before starting. Set it to `true` on exactly one service: the compose `backend` service, or the Kubernetes `sem-migrate` Job. |
| `RUN_SEED` | no | `false` | | api | The entrypoint runs the idempotent seed (`node dist/prisma/seed.js`) after migrations. |

## 2. Data stores

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `DATABASE_URL` | **yes** | derived in compose | S | api, worker | PostgreSQL 16 connection string, e.g. `postgresql://sem:PASS@host:5432/secureendpoint?schema=public`. Add `&sslmode=require` for managed databases. In compose it is built from `POSTGRES_*` unless you set it explicitly. |
| `REDIS_URL` | **yes** | derived in compose | S | api, worker | Redis 7 URL. BullMQ queues, rate limiting and caches use it. Use `rediss://` for TLS. The server must use `maxmemory-policy noeviction`. |

## 3. Authentication, sessions & security

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | **yes** | – | S | api | HS256 signing key for access tokens, 32 characters or more. Rotating it logs every user out within `JWT_ACCESS_TTL`. |
| `JWT_ACCESS_TTL` | no | `900` | | api | Access-token lifetime in seconds. |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | | api | Lifetime of a refresh token. Refresh tokens rotate on every use and are stored hashed in `sessions`. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | no | `30` | | api | Revokes a session after this much inactivity. See also the `sessionTimeoutMinutes` system setting (`PATCH /settings`). |
| `ENCRYPTION_KEY` | **yes** | – | S | api, worker | Base64 of exactly 32 random bytes. It is the AES-256-GCM key for `users.mfa_secret_enc`, `alert_channels.config_enc` and `software_whitelist.license_key_enc`. **Back it up. If you lose or change it, that data becomes unreadable.** See [RUNBOOK](RUNBOOK.md). |
| `CORS_ORIGINS` | no | `https://localhost` | | api | Comma-separated list of allowed browser origins. Set it to the console URL. |
| `WEB_URL` | **yes** | `https://localhost` | | api, worker | Public console URL. SSO callbacks redirect here, and email links and reports use it. |
| `API_PUBLIC_URL` | **yes** | `https://localhost/api/v1` | | api | Public API base URL. The enrollment install one-liners embed it. |
| `TRUST_PROXY` | no | `true` | | api | Trusts `X-Forwarded-*` headers from Nginx or the Ingress, so the backend sees the real client IP for audit, IP restrictions and rate limits. Keep it `true` only behind a proxy you control. |
| `RATE_LIMIT_TTL` | no | `60` | | api | Rate-limit window in seconds. |
| `RATE_LIMIT_MAX` | no | `300` | | api | Requests allowed per client per window, globally. |
| `AUTH_RATE_LIMIT_MAX` | no | `10` | | api | Requests allowed per client per window on `/auth/*`. |
| `SECURITY_MFA_REQUIRED_ROLES` | no | `SUPER_ADMIN,SECURITY_ADMIN` | | api | Roles that must enrol TOTP MFA. See also the `mfaRequiredRoles` system setting (`PATCH /settings`). |

## 4. Files, PKI & agent distribution

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `REPORTS_DIR` | no | `/data/reports` | | api, worker | Directory for generated reports. The worker writes them and the api streams them, so the directory must be on the **shared** volume: compose `app-data`, Kubernetes RWX PVC `sem-data`. |
| `CA_CERT_PATH` | no | `/data/pki/ca.crt` | | api | Internal device-CA certificate, created on first start if missing. It is published at `/api/v1/enrollment/ca.pem`. |
| `CA_KEY_PATH` | no | `/data/pki/ca.key` | S (file) | api | Internal device-CA private key. **Back it up and protect it.** Anyone who holds it can mint device certificates. |
| `AGENT_DOWNLOAD_BASE_URL` | **yes** | `https://localhost/downloads` | | api | Base URL where install scripts download the `sem-agent-*` binaries. Nginx or the `sem-downloads` Ingress serves it. |

## 5. Seed

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `SEED_ADMIN_EMAIL` | no | `admin@secureendpoint.local` | | api (seed) | Email of the initial SUPER_ADMIN account, created only if it does not exist. |
| `SEED_ADMIN_PASSWORD` | no | `ChangeMe!Secure2026` | S | api (seed) | Initial password. **Change it at first login**, or set a strong value before the first start. |
| `SEED_DEMO_DATA` | no | `true` (compose), `false` (k8s) | | api (seed) | Creates demo departments, policies, devices and one user per role (`secadmin@`, `compliance@`, `itadmin@`, `manager@`, `employee@`, `auditor@` at `secureendpoint.local`, same password as the admin). **Set it to `false` in production.** |
| `DEMO_ACTIVITY` | no | same as `SEED_DEMO_DATA` | | worker | Demo installs only: every 5 minutes, refreshes the last check-in of ~85% of the **seeded** demo devices so the dashboard does not drift to "0 online" and demo devices do not start failing `AGENT_OFFLINE`. Devices enrolled by a real agent are never touched. Set `false` to watch demo devices go offline. |

## 6. Email (SMTP)

The EMAIL alert channel and scheduled report delivery use these settings.

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `SMTP_HOST` | cond. | – | | worker, api | SMTP relay host. Leave it empty to disable email. |
| `SMTP_PORT` | no | `587` | | worker, api | Use `587` for STARTTLS or `465` for implicit TLS. |
| `SMTP_SECURE` | no | `false` | | worker, api | Set `true` for implicit TLS (port 465). With `false`, the connection upgrades with STARTTLS. |
| `SMTP_USER` | cond. | – | S | worker, api | SMTP username. |
| `SMTP_PASSWORD` | cond. | – | S | worker, api | SMTP password or app password. |
| `SMTP_FROM` | cond. | – | | worker, api | Sender, e.g. `SecureEndpoint Manager <no-reply@example.com>`. |

## 7. Twilio (SMS & WhatsApp)

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | cond. | – | S | worker, api | Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | cond. | – | S | worker, api | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | cond. | – | | worker, api | E.164 sender for SMS, e.g. `+15551234567`. |
| `TWILIO_WHATSAPP_FROM` | cond. | – | | worker, api | WhatsApp-enabled sender, e.g. `whatsapp:+14155238886`. |

## 8. LDAP / Active Directory

`POST /api/v1/auth/ldap/login` is enabled when `LDAP_URL` is set.

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `LDAP_URL` | cond. | – | | api | Use `ldaps://dc01.corp.example.com:636` in production. Plain `ldap://` is for development only. The Kubernetes NetworkPolicy allows egress on 636 only. |
| `LDAP_BIND_DN` | cond. | – | | api | Service account used to search for users, e.g. `CN=svc-sem,OU=Service Accounts,DC=corp,DC=example,DC=com`. |
| `LDAP_BIND_PASSWORD` | cond. | – | S | api | Password of the service account. |
| `LDAP_SEARCH_BASE` | cond. | – | | api | Base DN for user searches, e.g. `OU=Users,DC=corp,DC=example,DC=com`. |
| `LDAP_SEARCH_FILTER` | no | `(sAMAccountName={{username}})` | | api | `{{username}}` is replaced by the login name. For OpenLDAP, use `(uid={{username}})`. For UPN login on AD, use `(userPrincipalName={{username}})`. |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | no | `true` | | api | Verifies the directory's TLS certificate. Set `false` only in labs. |
| `LDAP_DEFAULT_ROLE` | no | `EMPLOYEE` | | api | Role assigned when none of the user's groups is mapped. |
| `LDAP_GROUP_ROLE_MAP` | no | `{}` | | api | JSON object that maps a directory group to a RoleKey, e.g. `{"CN=SEM-Admins,OU=Groups,DC=corp,DC=example,DC=com":"SUPER_ADMIN"}`. |

## 9. Microsoft Entra ID (Azure AD) SSO

The Entra ID provider is enabled when tenant ID, client ID and client secret are all set. [DEPLOYMENT.md](DEPLOYMENT.md#single-sign-on--directory-integration) walks through the app registration.

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `AZURE_AD_TENANT_ID` | cond. | – | | api | Directory (tenant) ID. |
| `AZURE_AD_CLIENT_ID` | cond. | – | | api | Application (client) ID. |
| `AZURE_AD_CLIENT_SECRET` | cond. | – | S | api | Client secret value (not the secret ID). |
| `AZURE_AD_REDIRECT_URI` | cond. | – | | api | `https://DOMAIN/api/v1/auth/sso/azure-ad/callback`. It must match the app registration exactly. |
| `AZURE_AD_GROUP_ROLE_MAP` | no | `{}` | | api | JSON object that maps an Entra **group object ID** to a RoleKey, e.g. `{"6f1c…":"SECURITY_ADMIN"}`. |

## 10. Generic OpenID Connect SSO

The OIDC provider covers Okta, Keycloak, Auth0, Google Workspace, Ping and others. It is enabled when issuer, client ID and client secret are all set.

| Variable | Req. | Default | Secret | Used by | Description |
|---|---|---|---|---|---|
| `OIDC_ISSUER` | cond. | – | | api | Issuer URL. The backend reads `/.well-known/openid-configuration` from it. |
| `OIDC_CLIENT_ID` | cond. | – | | api | Client ID. |
| `OIDC_CLIENT_SECRET` | cond. | – | S | api | Client secret. |
| `OIDC_REDIRECT_URI` | cond. | – | | api | `https://DOMAIN/api/v1/auth/sso/oidc/callback`. |

## 11. Compose-only variables

`docker-compose.yml` reads these variables. The backend never sees them.

| Variable | Default | Secret | Description |
|---|---|---|---|
| `DOMAIN` | `localhost` | | Public DNS name. The generators use it to build the URLs above. |
| `COMPOSE_PROJECT_NAME` | `secureendpoint` | | Prefix for containers, networks and volumes. |
| `IMAGE_REGISTRY` | `ghcr.io/secureendpoint/secureendpoint-manager` | | Registry and path for `backend`, `frontend` and `agent-dist` images. |
| `IMAGE_TAG` | `latest` | | Image tag. Pin a release version in production, e.g. `1.4.2`. |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | | Host ports that Nginx publishes. |
| `TLS_CERT_DIR` | `./deploy/nginx/certs` | | Host directory with `fullchain.pem` and `privkey.pem` (see [certs/README](../deploy/nginx/certs/README.md)). |
| `POSTGRES_USER` | `sem` | | Database owner. |
| `POSTGRES_PASSWORD` | – (**required**) | S | Must be URL-safe (hex), because compose embeds it in `DATABASE_URL`. |
| `POSTGRES_DB` | `secureendpoint` | | Database name. |
| `REDIS_PASSWORD` | – (**required**) | S | Passed to `redis-server --requirepass` and embedded in `REDIS_URL`. |
| `GRAFANA_ADMIN_USER` | `admin` | | Grafana admin user (profile `monitoring`). |
| `GRAFANA_ADMIN_PASSWORD` | – (required with `monitoring`) | S | Grafana admin password. |
| `MONITORING_BIND` | `127.0.0.1` | | Host interface for Grafana (3001), Prometheus (9090) and Alertmanager (9093). |
| `DEV_LDAP_URL`, `DEV_LDAP_ADMIN_PASSWORD` | `ldap://openldap:389`, `DevLdapAdmin!2026` | | Development override only (`docker-compose.dev.yml`). |

## 12. Frontend build

| Variable | Kind | Default | Description |
|---|---|---|---|
| `API_INTERNAL_URL` | Docker build arg | `http://backend:4000` | Baked into the Next.js `/api/*` rewrites at build time. The browser always calls the relative path `/api/v1`. Compose uses the `backend` service and Kubernetes uses the Service named `backend`, so the default works in both. |

## 13. Where each variable is set

| Variable group | `.env.example` | `docker-compose.yml` | `k8s config.env` | `k8s secret.example.yaml` |
|---|---|---|---|---|
| Runtime, rate limits, URLs, MFA roles, idle timeout | ✔ | ✔ | ✔ | |
| `DATABASE_URL`, `REDIS_URL` | commented (derived) | ✔ (derived) | | ✔ |
| `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY` | ✔ (generated) | ✔ | | ✔ |
| SMTP host/port/secure/from | ✔ | ✔ | ✔ | |
| `SMTP_USER`, `SMTP_PASSWORD` | ✔ | ✔ | | ✔ |
| Twilio SID/token | ✔ | ✔ | | ✔ |
| Twilio numbers | ✔ | ✔ | ✔ | |
| LDAP (non-secret) | ✔ | ✔ | ✔ | |
| `LDAP_BIND_PASSWORD`, `AZURE_AD_CLIENT_SECRET`, `OIDC_CLIENT_SECRET` | ✔ | ✔ | | ✔ |
| Azure AD / OIDC (non-secret) | ✔ | ✔ | ✔ | |
| `REPORTS_DIR`, `CA_*`, `AGENT_DOWNLOAD_BASE_URL` | ✔ | ✔ | ✔ | |
| `SEED_ADMIN_EMAIL`, `SEED_DEMO_DATA` | ✔ | ✔ | ✔ | |
| `SEED_ADMIN_PASSWORD` | ✔ | ✔ | | ✔ |
| `APP_ROLE`, `RUN_MIGRATIONS`, `RUN_SEED` | (`APP_ROLE` only) | per service | per Deployment/Job | |

> When you add a variable, update `.env.example`, `docker-compose.yml` (`x-backend-env`), `deploy/k8s/base/config.env` or `secret.example.yaml`, and this file. The pull-request template has a checklist item for it.
