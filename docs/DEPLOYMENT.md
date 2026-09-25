# Production Deployment Guide

This guide takes SecureEndpoint Manager from an empty host or cluster to a hardened production installation. It also covers day-2 operations: SSO, alert channels, agent rollout, backups, upgrades and monitoring.

| If you want to… | Go to |
|---|---|
| Try it locally in 5 minutes | [README → Quick start](../README.md#quick-start) |
| Run on one or two VMs (up to ~5k devices) | [Docker Compose production deployment](#docker-compose-production-deployment) |
| Run highly available on Kubernetes | [Kubernetes deployment](#kubernetes-deployment) |
| Look up a variable | [ENVIRONMENT.md](ENVIRONMENT.md) |
| Handle an incident or rotate a secret | [RUNBOOK.md](RUNBOOK.md) |

---

## Contents

- [Deployment options](#deployment-options)
- [Sizing](#sizing)
- [Prerequisites](#prerequisites)
- [DNS and TLS](#dns-and-tls)
- [Secrets generation](#secrets-generation)
- [Docker Compose production deployment](#docker-compose-production-deployment)
- [Kubernetes deployment](#kubernetes-deployment)
- [First-login hardening checklist](#first-login-hardening-checklist)
- [Single sign-on & directory integration](#single-sign-on--directory-integration)
- [Alert channels](#alert-channels)
- [Agent rollout](#agent-rollout)
- [Backups](#backups)
- [Restore](#restore)
- [Upgrades](#upgrades)
- [Monitoring](#monitoring)
- [Log shipping](#log-shipping)
- [Troubleshooting](#troubleshooting)

---

## Deployment options

| | Docker Compose | Kubernetes (Kustomize) |
|---|---|---|
| Files | `docker-compose.yml`, `.env`, `deploy/nginx`, `deploy/prometheus`, `deploy/grafana` | `deploy/k8s/base`, `overlays/{staging,production}`, `components/prometheus-operator` |
| Availability | Single host, restarts on failure | Multi-replica, PDBs, HPA, spread across zones |
| Database | Bundled PostgreSQL 16 container (or external via `DATABASE_URL`) | **Managed PostgreSQL recommended**. The optional StatefulSet in `deploy/k8s/postgres` is for labs and staging |
| TLS | Nginx with your certificate or Let's Encrypt | ingress-nginx and cert-manager |
| Migrations | `backend` service with `RUN_MIGRATIONS=true` on start | `sem-migrate` Job before each rollout (`deploy.yml`) |
| Good for | ≤ 5 000 devices, PoC, small and medium enterprises, air-gapped sites | Any size, and required above ~5 000 devices or when you need HA |

Architecture background: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Sizing

Assumptions: default intervals (heartbeat 300 s, full report 3600 s), about 150 software items per device, 90-day retention for events and compliance history. The load is roughly **devices ÷ 300 heartbeats/s** plus **devices ÷ 3600 reports/s**. Reports are the expensive requests.

| Fleet size | ≤ 1 000 devices | ≤ 10 000 devices | ≤ 50 000 devices |
|---|---|---|---|
| Recommended platform | Docker Compose, 1 VM | Kubernetes (or 2 large VMs + managed DB) | Kubernetes, multi-AZ |
| Agent traffic | ~3 req/s | ~35 req/s | ~170 req/s |
| api | 1 × (1 vCPU, 1 GiB) | 3 × (1 vCPU, 1–2 GiB), HPA to 6 | 6 × (2 vCPU, 2 GiB), HPA to 20 |
| worker | 1 × (1 vCPU, 1 GiB) | 2 × (1 vCPU, 2 GiB) | 4–8 × (2 vCPU, 3 GiB) |
| frontend | 1 × (0.5 vCPU, 512 MiB) | 2 × (0.5 vCPU, 512 MiB) | 3 × (1 vCPU, 768 MiB) |
| PostgreSQL | 2 vCPU, 4 GiB, 50 GB SSD | 4 vCPU, 16 GiB, 250 GB SSD (managed, HA) | 8–16 vCPU, 64 GiB, 1 TB SSD (managed, HA + read replica), PgBouncer |
| Redis | 512 MiB | 2 GiB (managed) | 4–8 GiB (managed, HA) |
| `/data` (RWX) | 10 GB | 50 GB | 200 GB |
| Single-VM total | 4 vCPU / 8 GiB / 100 GB | 8 vCPU / 32 GiB / 400 GB | n/a |
| Suggested policy tuning | defaults | defaults | `checkinIntervalSec` 600, `inventoryIntervalSec` 7200–14400 |

Notes:

- The biggest tables are `software_inventory` (≈ devices × 150 rows), `usb_events`, `compliance_results` (one row per evaluation) and `audit_logs`. Size the disk for your retention requirement, and watch the *Database size* panel in Grafana.
- For more than 10 000 devices, put PgBouncer (transaction mode) in front of PostgreSQL, and cap each pod's Prisma pool with `connection_limit` in `DATABASE_URL`, e.g. `...?schema=public&connection_limit=10`.
- Workers scale with queue depth. When `SemQueueBacklog` fires, add workers before you add api replicas.

---

## Prerequisites

**Common**

- A DNS name for the console, e.g. `sem.example.com`. Agents and browsers must both reach it over HTTPS (TCP 443).
- A TLS certificate for that name, from a public CA, your corporate PKI or Let's Encrypt.
- Outbound access from the backend to your SMTP relay (587/465), LDAPS (636), Entra ID or your OIDC IdP (443), Twilio (443) and Slack or Teams webhooks (443), as far as you use them.
- A secrets vault for `ENCRYPTION_KEY`, `JWT_ACCESS_SECRET` and database credentials.
- A backup target (object storage or a backup server).

**Docker Compose host**

- Linux x86_64 or arm64 (Ubuntu 22.04/24.04 LTS, RHEL 9, Debian 12). Docker Engine 24 or later with Compose v2.20 or later.
- Firewall: inbound 80 and 443 only. SSH restricted to administrators. Grafana, Prometheus and Alertmanager bind to `127.0.0.1` by default.
- NTP time sync. TOTP MFA and JWT expiry depend on the clock.

**Kubernetes**

- Kubernetes 1.28 or later (manifests are validated against 1.31).
- ingress-nginx, cert-manager, and metrics-server (for HPA).
- A **ReadWriteMany** StorageClass: AWS EFS CSI (`efs-sc`), Azure Files (`azurefile-csi-premium`), GCP Filestore, NFS, CephFS or Longhorn RWX.
- Managed PostgreSQL 16: Amazon RDS or Aurora, Azure Database for PostgreSQL Flexible Server, or Google Cloud SQL. Enable HA, PITR backups, encryption at rest and TLS.
- Managed Redis 7: ElastiCache, Azure Cache for Redis or Memorystore, with `maxmemory-policy=noeviction` and TLS.
- Optional: the Prometheus Operator (kube-prometheus-stack) for the `ServiceMonitor` and `PrometheusRule`, External Secrets Operator or Sealed Secrets, and a CNI that enforces NetworkPolicies (Calico, Cilium, or cloud CNIs with policy enabled).

---

## DNS and TLS

1. Create `A`/`AAAA` records (or a `CNAME` to your load balancer) for `sem.example.com`.
2. Obtain a certificate:
   - **Compose**: put `fullchain.pem` and `privkey.pem` in `deploy/nginx/certs/`, or point `TLS_CERT_DIR` elsewhere. [`deploy/nginx/certs/README.md`](../deploy/nginx/certs/README.md) covers corporate CA, Let's Encrypt (certbot webroot) and self-signed for labs (`scripts/gen-self-signed-cert.sh`).
   - **Kubernetes**: apply the ClusterIssuers once (`kubectl apply -f deploy/k8s/examples/cluster-issuer.yaml`, after you edit the ACME email). The `sem-web` Ingress requests the certificate into Secret `sem-tls`.
3. TLS policy: TLS 1.2 and 1.3 only, ECDHE AEAD ciphers, HSTS (2 years, includeSubDomains), no session tickets. Check it with `testssl.sh https://sem.example.com` or SSL Labs.
4. Agents validate the server certificate against the OS trust store. With a private CA, deploy the CA certificate to endpoints first (GPO, Intune or Jamf configuration profile) or agents will fail to enroll.

---

## Secrets generation

```bash
./scripts/generate-secrets.sh --domain sem.example.com          # Linux / macOS / Git Bash
.\scripts\generate-secrets.ps1 -Domain sem.example.com           # Windows PowerShell
```

The script copies `.env.example` to `.env`, replaces every `__GENERATE_*__` placeholder with a fresh random value (`openssl rand`), rewrites the `https://localhost` URLs to your domain, and sets the file mode to `600`. It refuses to overwrite an existing `.env`.

Before the first start, do the following:

- Set `SEED_DEMO_DATA=false` and a strong, unique `SEED_ADMIN_PASSWORD`, and set `SEED_ADMIN_EMAIL` to a real mailbox.
- Store `ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD` and `REDIS_PASSWORD` in your vault. **If you lose `ENCRYPTION_KEY`, you permanently lose the MFA secrets, alert-channel configurations and license keys.**
- Pin `IMAGE_TAG` to a release version, e.g. `1.4.2`, instead of `latest`.

For Kubernetes, the same values go into Secret `sem-secrets` (see [Kubernetes deployment, step 3](#kubernetes-deployment)).

---

## Docker Compose production deployment

```bash
# 1. Get the release
sudo mkdir -p /opt/secureendpoint && sudo chown "$USER" /opt/secureendpoint
cd /opt/secureendpoint
git clone --branch v1.4.2 https://github.com/<org>/secureendpoint-manager.git .

# 2. Configure
./scripts/generate-secrets.sh --domain sem.example.com
$EDITOR .env        # SEED_DEMO_DATA=false, SEED_ADMIN_*, SMTP_*, SSO/LDAP, IMAGE_TAG=1.4.2
cp /path/to/fullchain.pem /path/to/privkey.pem deploy/nginx/certs/
chmod 600 deploy/nginx/certs/privkey.pem

# 3. Validate
docker compose config -q && echo "compose OK"

# 4. Start (images are pulled from IMAGE_REGISTRY:IMAGE_TAG; add --build to build locally)
docker compose pull
docker compose up -d
docker compose --profile monitoring up -d        # optional: Prometheus, Alertmanager, Grafana

# 5. Verify
docker compose ps
curl -fsS https://sem.example.com/api/v1/health
curl -fsS https://sem.example.com/api/v1/health/ready
curl -fsSI https://sem.example.com/downloads/checksums.txt
```

Start-up order is enforced by health checks. `postgres` and `redis` come up first. `backend` then applies migrations and seeds, and becomes healthy. `worker` and `frontend` start after it. `agent-dist` fills the `downloads` volume and exits. `nginx` starts last.

**What the compose file does for you**

| Control | Implementation |
|---|---|
| Network isolation | `data-net` is `internal: true`. PostgreSQL and Redis have no published ports and no internet egress. Only Nginx publishes 80 and 443 |
| Least privilege | `read_only: true` root file systems with explicit `tmpfs`, `no-new-privileges`, CPU and memory limits on every service |
| Resilience | `restart: unless-stopped`, health checks, `depends_on: condition: service_healthy` |
| Logging | `json-file` driver with 10 MB × 5 rotation per container |
| Persistence | Named volumes `postgres-data`, `redis-data`, `app-data` (reports and CA), `downloads`, plus monitoring volumes |

**Host hardening checklist**

- Enable unattended OS security updates. Keep Docker current.
- Set Docker daemon options: `"live-restore": true`, `"userland-proxy": false`, `"no-new-privileges": true` in `/etc/docker/daemon.json`.
- Put `/var/lib/docker` on encrypted storage. The volumes contain the database and the CA key.
- Restrict SSH (keys only, no root login, fail2ban or an equivalent).
- Reach Grafana through an SSH tunnel: `ssh -L 3001:127.0.0.1:3001 admin@sem-host`, then open `http://localhost:3001`.

**External database with Compose.** Set `DATABASE_URL` (and optionally `REDIS_URL`) in `.env`. They override the derived values. Then start only the services you need: `docker compose up -d backend worker frontend agent-dist nginx`. The bundled postgres and redis containers still start because of `depends_on`, but nothing uses them.

---

## Kubernetes deployment

Manifests live in `deploy/k8s` ([README](../deploy/k8s/README.md)):

```
deploy/k8s/
├── base/                         namespace (PSA restricted), ConfigMap (config.env), ServiceAccount,
│                                 sem-api (Service "backend"), sem-worker, sem-frontend (Service "frontend"),
│                                 sem-downloads, sem-migrate Job, PVC sem-data (RWX), Ingresses, NetworkPolicies
├── components/prometheus-operator ServiceMonitor + PrometheusRule (optional)
├── postgres/  redis/             optional in-cluster StatefulSets (labs / staging only)
├── overlays/staging              in-cluster DB/Redis, 1–2 replicas, letsencrypt-staging, demo data
├── overlays/production           managed DB/Redis, 3+ replicas, larger resources, pinned tags
└── examples/                     ClusterIssuers, ExternalSecret
```

### 1. Cluster add-ons

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace \
  --set controller.config.hsts=true \
  --set controller.config.hsts-max-age=63072000 \
  --set controller.config.hsts-include-subdomains=true \
  --set controller.config.use-forwarded-headers=true \
  --set controller.config.enable-real-ip=true \
  --set-string 'controller.config.global-allowed-response-headers=X-Frame-Options\,X-Content-Type-Options\,Referrer-Policy\,Permissions-Policy\,Cross-Origin-Opener-Policy\,Content-Security-Policy'
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true
kubectl apply -f deploy/k8s/examples/cluster-issuer.yaml     # edit the ACME e-mail first
```

The NetworkPolicies assume ingress-nginx runs in namespace `ingress-nginx`, Prometheus in `monitoring`, and CoreDNS in `kube-system`. Adjust `deploy/k8s/base/networkpolicies.yaml` if your cluster differs.

### 2. Managed PostgreSQL and Redis

- PostgreSQL 16: create database `secureendpoint` and a login role `sem` that owns it. The migrations need DDL rights. Require TLS (`sslmode=require`, or `verify-full` with the provider CA). Enable automated backups with PITR of at least 7 days.
- Redis 7: set `maxmemory-policy noeviction`, enable TLS (`rediss://`) and AUTH.
- Restrict both to the cluster's egress CIDRs. Narrow the `0.0.0.0/0` blocks in the `backend-egress` NetworkPolicy to those CIDRs.

### 3. Namespace and secrets

```bash
kubectl create namespace secureendpoint --dry-run=client -o yaml | kubectl apply -f -
kubectl -n secureendpoint create secret generic sem-secrets \
  --from-literal=DATABASE_URL='postgresql://sem:<pw>@<pg-host>:5432/secureendpoint?schema=public&sslmode=require&connection_limit=10' \
  --from-literal=REDIS_URL='rediss://:<pw>@<redis-host>:6380/0' \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=SEED_ADMIN_PASSWORD='<strong-initial-password>' \
  --from-literal=SMTP_USER='' --from-literal=SMTP_PASSWORD='' \
  --from-literal=TWILIO_ACCOUNT_SID='' --from-literal=TWILIO_AUTH_TOKEN='' \
  --from-literal=LDAP_BIND_PASSWORD='' --from-literal=AZURE_AD_CLIENT_SECRET='' --from-literal=OIDC_CLIENT_SECRET=''
```

For GitOps, do not create Secrets by hand. Use the External Secrets Operator ([`examples/external-secret.yaml`](../deploy/k8s/examples/external-secret.yaml)) or Sealed Secrets. The key list is in [`base/secret.example.yaml`](../deploy/k8s/base/secret.example.yaml). Record `ENCRYPTION_KEY` in the vault **before** first start.

### 4. Customise the overlay

In `deploy/k8s/overlays/production/kustomization.yaml`:

- Hostnames: the Ingress patch plus the `sem-config` literals `WEB_URL`, `CORS_ORIGINS`, `API_PUBLIC_URL`, `AGENT_DOWNLOAD_BASE_URL` and the SSO redirect URIs.
- `images`: the registry path and the release tag. The deploy workflow sets these automatically.
- `storageClassName` for `sem-data` (RWX).
- Non-secret integration settings in `sem-config`: SMTP host and from address, LDAP URL and base DN, Azure tenant and client ID, OIDC issuer and client ID.
- Remove `components/prometheus-operator` if the Prometheus Operator CRDs are not installed.

Render and validate:

```bash
kubectl kustomize deploy/k8s/overlays/production > /tmp/sem.yaml
docker run --rm -v /tmp:/w ghcr.io/yannh/kubeconform:latest -strict -summary -ignore-missing-schemas /w/sem.yaml
# or: make k8s-validate
```

### 5. Migrate, then roll out

```bash
kubectl kustomize deploy/k8s/overlays/production > /tmp/sem.yaml
# ConfigMaps + migration Job first
kubectl apply -f /tmp/sem.yaml -l 'app.kubernetes.io/component in (config)'
kubectl -n secureendpoint delete job sem-migrate --ignore-not-found
kubectl apply -f /tmp/sem.yaml -l 'app.kubernetes.io/component in (migration)'
kubectl -n secureendpoint wait --for=condition=complete job/sem-migrate --timeout=15m
kubectl -n secureendpoint logs job/sem-migrate
# everything else
kubectl apply -f /tmp/sem.yaml
for d in sem-api sem-worker sem-frontend sem-downloads; do
  kubectl -n secureendpoint rollout status deploy/$d --timeout=10m
done
curl -fsS https://sem.example.com/api/v1/health/ready
```

In CI/CD, the GitHub Actions workflow `.github/workflows/deploy.yml` does exactly this. It verifies the cosign signatures, runs the migration Job, applies the manifests, waits for the rollout, runs smoke tests and rolls back on failure. Protect the `production` environment with required reviewers. The workflow needs the environment secret `KUBE_CONFIG` (base64 kubeconfig bound to a namespace-scoped Role) and the variable `APP_URL`.

Argo CD users can point an Application at `deploy/k8s/overlays/production`. The Job carries `argocd.argoproj.io/hook: PreSync`.

### 6. Security properties of the manifests

- The namespace enforces Pod Security Admission `restricted`.
- Every pod runs non-root, with `readOnlyRootFilesystem`, all capabilities dropped, the `RuntimeDefault` seccomp profile, and no service-account token.
- NetworkPolicies default-deny ingress and egress. Explicit rules allow ingress-controller → web tier, frontend → api, Prometheus → `/metrics`, and backend → DB, Redis and integrations on 443/465/587/636 (cloud metadata IP blocked).
- PDBs (`maxUnavailable: 1`), zone and host `topologySpreadConstraints`, and HPAs on CPU and memory.
- The Ingress never routes `/metrics`. Auth endpoints get a separate, stricter rate limit (`sem-auth`). Agent traffic has its own Ingress (`sem-agent`) with optional mTLS annotations.

---

## First-login hardening checklist

Complete this list before you enroll production devices.

- [ ] Log in as `SEED_ADMIN_EMAIL` and **change the password**. Policy: 12 characters or more, with upper, lower, digit and symbol.
- [ ] **Enrol MFA** (TOTP). Store the recovery codes offline. MFA is mandatory for `SUPER_ADMIN` and `SECURITY_ADMIN` by default (`SECURITY_MFA_REQUIRED_ROLES`). Consider adding `IT_ADMIN,COMPLIANCE_OFFICER`.
- [ ] Create named admin accounts, or map SSO groups, so the seed admin is break-glass only. Keep it with MFA in a sealed envelope or vault.
- [ ] Confirm `SEED_DEMO_DATA=false`. If demo data was seeded by mistake, deactivate the demo users (`DELETE /users/:id`) and retire the demo devices.
- [ ] Configure **IP restrictions** for the console (`Settings → IP restrictions`, `POST /settings/ip-restrictions {cidr}`). Add your office and VPN egress CIDRs **before** you enable, to avoid locking yourself out. Agent endpoints are exempt.
- [ ] Configure **SSO** (Entra ID or OIDC) and/or LDAP, with group → role mapping (next section).
- [ ] Review the **role → permission matrix** (`Roles`). Apply least privilege and restrict `roles:write` and `settings:write`.
- [ ] Set the session idle timeout and MFA-required roles in `Settings` if they differ from the env defaults.
- [ ] Review the **default policy** (USB storage blocked, encryption, AV and EDR required, and so on) and create department-specific policies.
- [ ] Review the **compliance rules** (severity, weight, `markNonCompliant`), see [COMPLIANCE-ENGINE.md](COMPLIANCE-ENGINE.md).
- [ ] Create **alert channels** (email plus Slack or Teams at minimum), then run *Test*.
- [ ] Create the software **whitelist** (approved catalog) and **blacklist** before you enable `blockUnauthorizedSoftware` broadly.
- [ ] Create **enrollment tokens** per platform and department, with sensible `maxUses` and expiry.
- [ ] Verify the audit chain: `GET /audit/verify` must return `valid: true`.
- [ ] Back up `.env` or `sem-secrets` **and** `/data/pki` now (see [Backups](#backups)).
- [ ] Optional: enable agent **mTLS** after all agents have enrolled (see [SECURITY.md](SECURITY.md)).

---

## Single sign-on & directory integration

Configured providers appear on the login page (`GET /api/v1/auth/sso/providers`). Users provisioned through SSO or LDAP get `authProvider` set to `AZURE_AD`, `OIDC`, `LDAP` or `ACTIVE_DIRECTORY`, and have no local password.

### Microsoft Entra ID (Azure AD)

1. **Entra admin center → Identity → Applications → App registrations → New registration**
   - Name: `SecureEndpoint Manager`
   - Supported account types: *Accounts in this organizational directory only* (single tenant)
   - Redirect URI: platform **Web**, `https://sem.example.com/api/v1/auth/sso/azure-ad/callback`
2. On the **Overview** page, copy the *Application (client) ID* into `AZURE_AD_CLIENT_ID` and the *Directory (tenant) ID* into `AZURE_AD_TENANT_ID`.
3. **Certificates & secrets → Client secrets → New client secret**. Choose a 12- or 24-month expiry and copy the **Value** (not the ID) into `AZURE_AD_CLIENT_SECRET`. Put a reminder in the calendar before it expires.
4. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**: `openid`, `profile`, `email`, `User.Read`, `GroupMember.Read.All`. Then **Grant admin consent for <tenant>**.
5. **Token configuration → Add groups claim**. Select *Security groups*, and under ID choose *Group ID*. If users belong to more than 200 groups, assign only the relevant groups to the application (*Enterprise applications → SecureEndpoint Manager → Properties → Assignment required = Yes*, then *Users and groups*) and choose *Groups assigned to the application*. This avoids the groups-overage claim.
6. Optionally, **Enterprise applications → SecureEndpoint Manager → Conditional Access**: require MFA and compliant devices for this app.
7. Configure the backend:
   ```dotenv
   AZURE_AD_TENANT_ID=00000000-0000-0000-0000-000000000000
   AZURE_AD_CLIENT_ID=11111111-1111-1111-1111-111111111111
   AZURE_AD_CLIENT_SECRET=<secret value>
   AZURE_AD_REDIRECT_URI=https://sem.example.com/api/v1/auth/sso/azure-ad/callback
   # group object ID -> RoleKey
   AZURE_AD_GROUP_ROLE_MAP={"8c2f...":"SUPER_ADMIN","1d9e...":"SECURITY_ADMIN","4b7a...":"IT_ADMIN","a0c3...":"COMPLIANCE_OFFICER","77e1...":"DEPARTMENT_MANAGER","5f2d...":"AUDITOR"}
   ```
   Apply with `docker compose up -d backend worker`. On Kubernetes, update `sem-config` and `sem-secrets`, then `kubectl rollout restart deploy/sem-api`.
8. Test: open the console, choose *Sign in with Microsoft*, and confirm the user and role under *Users*. The callback redirects to `${WEB_URL}/auth/callback#accessToken=…` (or `#mfaToken=…` when the user must complete local MFA).

Users with no mapped group get the backend default role. Keep privileged roles mapped only from dedicated, access-reviewed groups.

### Generic OIDC (Okta, Keycloak, Auth0, Google Workspace, Ping)

1. In your IdP, create a **confidential web application** (authorization code flow):
   - Sign-in redirect URI: `https://sem.example.com/api/v1/auth/sso/oidc/callback`
   - Scopes: `openid profile email`
   - Grant type: authorization code (PKCE is fine if the IdP supports it for confidential clients)
2. Configure:
   ```dotenv
   OIDC_ISSUER=https://idp.example.com/realms/corp        # must serve /.well-known/openid-configuration
   OIDC_CLIENT_ID=secureendpoint
   OIDC_CLIENT_SECRET=<secret>
   OIDC_REDIRECT_URI=https://sem.example.com/api/v1/auth/sso/oidc/callback
   ```
3. There is no environment variable for OIDC group → role mapping. Users who sign in through OIDC receive the backend's default role, and an administrator assigns roles in *Users* (`PATCH /users/:id {roleKey}`). Keep IdP assignment of the app restricted to people who should have access.

### LDAP / Active Directory

1. Create a least-privilege **service account** (read-only on user and group objects), e.g. `CN=svc-sem,OU=Service Accounts,DC=corp,DC=example,DC=com`.
2. Use **LDAPS** (636). Plain LDAP is blocked by the Kubernetes NetworkPolicy and sends credentials in clear text.
3. If the domain controllers use a private CA, make Node.js trust it with the standard `NODE_EXTRA_CA_CERTS` variable:
   ```yaml
   # docker-compose.override.yml
   services:
     backend:
       environment: { NODE_EXTRA_CA_CERTS: /etc/sem/ad-ca.pem }
       volumes: ["./deploy/ad-ca.pem:/etc/sem/ad-ca.pem:ro"]
   ```
   Keep `LDAP_TLS_REJECT_UNAUTHORIZED=true`.
4. Configure:
   ```dotenv
   LDAP_URL=ldaps://dc01.corp.example.com:636
   LDAP_BIND_DN=CN=svc-sem,OU=Service Accounts,DC=corp,DC=example,DC=com
   LDAP_BIND_PASSWORD=<password>
   LDAP_SEARCH_BASE=OU=Users,DC=corp,DC=example,DC=com
   LDAP_SEARCH_FILTER=(&(objectClass=user)(sAMAccountName={{username}})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
   LDAP_TLS_REJECT_UNAUTHORIZED=true
   LDAP_DEFAULT_ROLE=EMPLOYEE
   LDAP_GROUP_ROLE_MAP={"CN=SEM-Admins,OU=Groups,DC=corp,DC=example,DC=com":"SUPER_ADMIN","CN=SEM-Security,OU=Groups,DC=corp,DC=example,DC=com":"SECURITY_ADMIN","CN=SEM-IT,OU=Groups,DC=corp,DC=example,DC=com":"IT_ADMIN","CN=SEM-Auditors,OU=Groups,DC=corp,DC=example,DC=com":"AUDITOR"}
   ```
   The example filter excludes disabled AD accounts. For OpenLDAP, use `(uid={{username}})`.
5. Test with `curl -fsS -X POST https://sem.example.com/api/v1/auth/ldap/login -H 'Content-Type: application/json' -d '{"username":"jdoe","password":"…"}'`.

For local development, `docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile ldap up -d` starts OpenLDAP with sample users (`ldap.admin`, `ldap.sec`, `ldap.it`, `ldap.audit`, `ldap.user`, password `LdapUser!2026`). See `deploy/dev/ldap/bootstrap.ldif`.

---

## Alert channels

Channels are created in the console (*Alerts → Channels*) or with `POST /api/v1/alerts/channels`. Each channel has `minSeverity` (default `HIGH`) and optional `categories` (`COMPLIANCE`, `USB`, `SOFTWARE`, `SECURITY`, `PATCH`, `AUTH`, `DEVICE`, `SYSTEM`). The channel `config` is encrypted at rest and returned masked. Always run **Test** (`POST /alerts/channels/:id/test`) after you create a channel.

```bash
curl -fsS -X POST https://sem.example.com/api/v1/alerts/channels \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"SecOps e-mail","type":"EMAIL","config":{"recipients":["secops@example.com"]},
       "minSeverity":"HIGH","categories":["COMPLIANCE","SECURITY","USB"],"enabled":true}'
```

| Channel | Server-side configuration | `config` body |
|---|---|---|
| **EMAIL** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | `{ "recipients": ["secops@example.com"] }` |
| **SMS** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `{ "provider": "twilio", "to": ["+15551230000"] }` |
| **WHATSAPP** | Twilio credentials, `TWILIO_WHATSAPP_FROM` | `{ "to": ["+15551230000"] }` |
| **SLACK** | – | `{ "webhookUrl": "https://hooks.slack.com/services/…" }` |
| **TEAMS** | – | `{ "webhookUrl": "https://…" }` |
| **WEBHOOK** | – | `{ "url": "https://siem.example.com/hooks/sem", "secret": "…" }` |

**SMTP examples**

| Provider | Settings |
|---|---|
| Microsoft 365 | `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS). The mailbox needs *Authenticated SMTP* enabled. Alternatively, use an Exchange connector or relay |
| Amazon SES | `SMTP_HOST=email-smtp.<region>.amazonaws.com`, `587`, SMTP IAM credentials, verified `SMTP_FROM` domain |
| SendGrid | `SMTP_HOST=smtp.sendgrid.net`, `587`, `SMTP_USER=apikey`, `SMTP_PASSWORD=<API key>` |
| Internal relay | `SMTP_HOST=relay.corp.example.com`, `25` or `587`, no auth, allow-listed by source IP |

Configure SPF, DKIM and DMARC for the `SMTP_FROM` domain, or alerts will land in spam.

**Twilio.** Buy an SMS-capable number and set `TWILIO_FROM_NUMBER` in E.164 format. For WhatsApp, use the Twilio sandbox (`whatsapp:+14155238886`) for testing, and an approved WhatsApp Business sender in production. Recipients of sandbox messages must first opt in.

**Slack.** Go to *api.slack.com/apps → Create app → Incoming Webhooks → Activate → Add New Webhook to Workspace*, then pick the channel and paste the URL.

**Microsoft Teams.** In the target channel, create a **Workflows** webhook (*… → Workflows → "Post to a channel when a webhook request is received"*) and paste the generated URL. Legacy Office 365 connectors are being retired by Microsoft, so prefer Workflows.

**Generic webhook.** The backend POSTs a JSON alert to `url`. When `secret` is set, it adds `X-SEM-Signature` (HMAC-SHA256 with the channel secret). Verify the signature on the receiver before you trust the payload (see [SECURITY.md](SECURITY.md)). Use this channel to feed SIEM or SOAR tools (Splunk HEC through a proxy, Sentinel Logic Apps, PagerDuty Events, ServiceNow).

Infrastructure alerts (API down, queue backlog and so on) come from Prometheus through Alertmanager and are configured separately in `deploy/prometheus/alertmanager.yml`.

---

## Agent rollout

1. Create an **enrollment token** (*Enrollment → Tokens*, `POST /api/v1/enrollment/tokens`) scoped to a platform, department and policy, with `maxUses` about 10 % above the device count and a short expiry. The raw token (`sem_enr_…`) is shown **once**.
2. Get the exact install command for each platform (*Enrollment → Install command*, `GET /api/v1/enrollment/install-command?tokenId=<id>&platform=WINDOWS|LINUX|MACOS`). It returns `{ platform, command, downloadUrl }`, and the command already contains your server URL and token.
3. Pilot on 5–10 devices per platform and check them under *Devices* (status `ACTIVE`, recent `lastSeenAt`, compliance evaluated). If the token has `autoApprove=false`, approve the pending devices (*Enrollment → Pending*).
4. Roll out in waves through your software-distribution tool, as in the examples below.

> The snippets below show **how to wrap** the command returned by `install-command`. Paste that command where you see `<INSTALL COMMAND>` rather than retyping its arguments. Binaries and scripts are served from `https://sem.example.com/downloads/` together with `checksums.txt` (SHA-256), and releases are additionally signed with cosign (see [SECURITY.md](SECURITY.md)).

**Microsoft Intune (Windows).** Use *Devices → Scripts and remediations → Platform scripts → Add → Windows 10 and later*:

```powershell
# sem-enroll.ps1 — run in 64-bit PowerShell as SYSTEM
$ErrorActionPreference = 'Stop'
<INSTALL COMMAND>
```

Settings: *Run this script using the logged on credentials* = **No**, *Run script in 64-bit PowerShell* = **Yes**. For a Win32 app with detection rules, package `install.ps1` with `IntuneWinAppUtil.exe` and detect the installed service.

**Group Policy (Windows AD).** Store the script on `\\corp.example.com\NETLOGON\sem\sem-enroll.ps1` (read-only for Domain Computers). Then go to *Computer Configuration → Policies → Windows Settings → Scripts → Startup → PowerShell Scripts* and add `sem-enroll.ps1`. Make the script idempotent: exit early if the agent service already exists.

```powershell
if (Get-Service -Name 'sem-agent*' -ErrorAction SilentlyContinue) { exit 0 }
<INSTALL COMMAND>
```

**Microsoft Configuration Manager (SCCM/MECM).** Create an Application with deployment type *Script Installer*. The installation program is `powershell.exe -NoProfile -ExecutionPolicy Bypass -File sem-enroll.ps1`, and the detection method is *Windows service exists* or a script check. Deploy it as **Required** to a device collection, with a maintenance window.

**Jamf Pro (macOS).**

1. *Settings → Computer management → Scripts → New*. Paste the command returned for `platform=MACOS`:
   ```bash
   #!/bin/zsh
   set -euo pipefail
   <INSTALL COMMAND>
   ```
2. Create a *Policy* with the script, trigger *Recurring check-in* and *Enrollment complete*, execution frequency *Once per computer*, scoped to a smart group.
3. Deploy the configuration profiles the agent needs **before** the script. Your agent release notes define them: typically Full Disk Access (PPPC) and, if you use a private CA, the CA certificate payload.

**Ansible (Linux, also macOS).**

```yaml
# sem-agent.yml — ansible-playbook -i inventory sem-agent.yml -e sem_enroll_token=sem_enr_...
- hosts: linux_endpoints
  become: true
  vars:
    sem_url: https://sem.example.com
  tasks:
    - name: Check whether the agent is already installed
      ansible.builtin.stat:
        path: /etc/systemd/system/sem-agent.service   # adjust to the unit name your agent release installs
      register: sem_unit

    - name: Enroll SecureEndpoint agent
      ansible.builtin.shell: |
        set -euo pipefail
        <INSTALL COMMAND with {{ sem_enroll_token }} substituted>
      args:
        executable: /bin/bash
      when: not sem_unit.stat.exists
      no_log: true          # the command contains the enrollment token
```

**Verification at scale**

- Dashboard: *online devices* and *devices total* rise as waves complete, visible in the Grafana *Compliance Overview*.
- `GET /api/v1/devices?online=false` lists devices that enrolled but stopped checking in.
- Revoke the enrollment token when the rollout is finished (`DELETE /api/v1/enrollment/tokens/:id`).

---

## Backups

What to back up, from most to least critical:

| Asset | Why | How often |
|---|---|---|
| **`ENCRYPTION_KEY`** (in `.env` or `sem-secrets`) | Without it, encrypted columns are unrecoverable | Once, in the vault, plus after any change |
| **`/data/pki/ca.key` + `ca.crt`** | The device CA. Losing it means every agent must re-enroll. Leaking it lets an attacker impersonate devices | After first start, then with every `/data` backup (encrypted) |
| **PostgreSQL** | All state, including the audit trail | Continuous (WAL/PITR) plus a nightly logical dump |
| `/data/reports` | Generated reports (can be regenerated) | Daily |
| `.env`, TLS certificates, overlay customisations | Rebuild the deployment | On change (in the vault or a private repo) |
| Redis | Queues only, transient | Not required (AOF is on for crash safety) |

### Docker Compose

**Nightly logical dump** (cron on the host):

```bash
# /etc/cron.d/secureendpoint-backup
15 2 * * * root cd /opt/secureendpoint && \
  docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /var/backups/sem/pg-$(date +\%F).dump && \
  find /var/backups/sem -name 'pg-*.dump' -mtime +14 -delete
```

(`make backup` does the same ad hoc, writing to `./backups/`.)

**`/data` volume (reports + CA)**, encrypted before it leaves the host:

```bash
docker run --rm -v secureendpoint_app-data:/data:ro -v /var/backups/sem:/backup alpine \
  tar czf /backup/data-$(date +%F).tgz -C /data .
age -r age1yourpublickey... -o /var/backups/sem/data-$(date +%F).tgz.age /var/backups/sem/data-$(date +%F).tgz \
  && rm /var/backups/sem/data-$(date +%F).tgz
```

Ship `/var/backups/sem` off-host (restic, borg, `aws s3 sync` with SSE-KMS) and keep at least 30 days.

**Point-in-time recovery with WAL-G** (optional, recommended for more than 1 000 devices). Extend the `postgres` service with continuous archiving:

```yaml
# docker-compose.override.yml (sketch — build an image with wal-g installed)
services:
  postgres:
    image: registry.example.com/postgres-walg:16
    command: ["postgres", "-c", "archive_mode=on", "-c", "archive_command=wal-g wal-push %p", "-c", "archive_timeout=60"]
    environment:
      WALG_S3_PREFIX: s3://sem-backups/wal-g
      AWS_REGION: eu-west-1
      WALG_COMPRESSION_METHOD: zstd
      WALG_LIBSODIUM_KEY_PATH: /run/secrets/walg-key
```

Take a base backup nightly (`wal-g backup-push $PGDATA`) and keep 7–30 days (`wal-g delete retain FULL 7 --confirm`).

### Kubernetes

- **Managed PostgreSQL**: enable automated backups with PITR (7–35 days) and cross-region snapshot copies. Also run a weekly `pg_dump` CronJob to object storage for logical portability.
- **`sem-data` PVC**: back it up with Velero (file-system backup or CSI snapshots), or the storage provider's snapshot feature (EFS Backup, Azure Files snapshots).
- **Secrets**: they live in your external secret store, which is backed up by the provider.

Test restores quarterly (see [Restore](#restore)) and record the result.

---

## Restore

1. **Stop writers**: `docker compose stop backend worker frontend nginx` (Kubernetes: `kubectl -n secureendpoint scale deploy sem-api sem-worker --replicas=0`).
2. **Restore the database** into an empty database:
   ```bash
   docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < /var/backups/sem/pg-2026-09-24.dump
   ```
   Managed DB: restore the PITR or snapshot to a new instance, then update `DATABASE_URL`.
3. **Restore `/data`** (reports + CA). The CA must match the device certificates in the database:
   ```bash
   age -d -i key.txt /var/backups/sem/data-2026-09-24.tgz.age > /tmp/data.tgz
   docker run --rm -v secureendpoint_app-data:/data -v /tmp:/backup alpine sh -c 'rm -rf /data/* && tar xzf /backup/data.tgz -C /data'
   ```
4. **Use the same `ENCRYPTION_KEY`** as when the dump was taken.
5. **Start**: `docker compose up -d` (or scale back up). Pending migrations run automatically if the backup predates the running version.
6. **Verify**: `GET /api/v1/health/ready`, log in, `GET /api/v1/audit/verify` must return `valid: true`, and devices must check in again (the Grafana *Agent check-ins* panel).
7. Devices that enrolled **after** the backup was taken no longer exist in the database. Re-run the installer on them.

---

## Upgrades

Releases follow SemVer. Images are signed, and each GitHub Release lists migrations and breaking changes.

**Policy**

- Database migrations are **forward-only** and follow expand → migrate → contract. Release N's schema stays compatible with release N-1's code, so rolling updates are safe. Destructive changes land at least one minor release after the code stopped using the column.
- **Rolling back the application is safe within one minor version. Rolling back the schema is not supported**: restore a backup instead.
- Always take a backup (dump plus `/data`) before a minor or major upgrade.

**Docker Compose**

```bash
cd /opt/secureendpoint
make backup
git fetch --tags && git checkout v1.5.0          # updates compose/nginx/prometheus/grafana files
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=1.5.0/' .env
diff <(grep -oE '^[A-Z_]+=' .env.example | sort) <(grep -oE '^[A-Z_]+=' .env | sort)   # new variables?
docker compose pull
docker compose up -d               # backend applies migrations on start (RUN_MIGRATIONS=true); worker waits for it
docker compose run --rm agent-dist # refresh /downloads with the new agent binaries
docker compose ps && curl -fsS https://sem.example.com/api/v1/health/ready
```

**Kubernetes.** Run the *Deploy* workflow with the new tag against staging, run your acceptance checks, then run it against production (approval required). The workflow runs `sem-migrate` before rolling pods. Manually, repeat [Kubernetes deployment, step 5](#kubernetes-deployment).

**Agents.** New agent binaries appear under `/downloads/` when `agent-dist` (compose) or the `sem-downloads` pods (Kubernetes) run with the new tag. Distribute the new version with the same tool you used for the rollout, and follow the agent release notes for in-place upgrade behaviour. Watch agent versions under *Devices* (the `agentVersion` column).

---

## Monitoring

**Docker Compose.** Run `docker compose --profile monitoring up -d`, then reach the tools through an SSH tunnel:

| Tool | URL (on the host) | Notes |
|---|---|---|
| Grafana | `http://127.0.0.1:3001` | Log in with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`. Dashboards live in folder *SecureEndpoint* |
| Prometheus | `http://127.0.0.1:9090` | Scrapes `backend:4000/metrics`, `worker:4000/metrics`, postgres-exporter and redis-exporter |
| Alertmanager | `http://127.0.0.1:9093` | Edit `deploy/prometheus/alertmanager.yml` (SMTP and Slack placeholders) |

Add `--profile node-exporter` on Linux hosts for host metrics.

**Kubernetes.** Keep `components/prometheus-operator` in the overlay. The `ServiceMonitor` selects Services labelled `sem.io/metrics: "true"` (`backend`, `sem-worker-metrics`), and the `PrometheusRule` carries the same rules as `deploy/prometheus/alerts.yml` (regenerate it with `make prometheusrule`). Import the two dashboards from `deploy/grafana/dashboards/` into your Grafana; they use a `datasource` variable.

**Dashboards**

- **SecureEndpoint — Compliance Overview**: devices total, compliance rate gauge, online devices, CRITICAL-risk devices, open alerts, software violations, compliance by state, risk distribution, platforms, alerts by severity, USB blocks per minute, check-ins per minute, evaluations per minute, and trends.
- **SecureEndpoint — Platform Health**: requests per second by route, error rates, p50/p95/p99 latency, slowest routes, queue jobs by state, notifications by channel and status, login attempts by result, Node.js CPU, memory and event-loop lag, and PostgreSQL and Redis exporter panels.

**Alert rules** (`deploy/prometheus/alerts.yml`)

| Alert | Condition | Severity |
|---|---|---|
| `SemApiDown` / `SemWorkerDown` | no api/worker target up for 2 m / 5 m | critical |
| `SemApiInstanceDown` | a single api target down for 5 m | warning |
| `SemPostgresDown` / `SemRedisDown` | exporter reports down for 1 m | critical |
| `SemHighErrorRate` | 5xx above 5 % for 10 m | critical |
| `SemHighLatencyP95` | p95 above 1 s for 10 m | warning |
| `SemEventLoopLag` | p99 event-loop lag above 0.5 s for 10 m | warning |
| `SemQueueBacklog` / `SemQueueFailedJobs` | more than 500 waiting / more than 50 failed jobs for 15 m | warning |
| `SemAlertDeliveryFailures` | more than 5 failed notifications in 15 m | warning |
| `SemLoginFailureSpike` | more than 50 failed logins in 10 m | warning |
| `SemComplianceRateLow` | fleet compliance below 80 % for 30 m | warning |
| `SemCriticalRiskDevices` | at least one CRITICAL-risk device for 1 h | critical |
| `SemUsbBlockSpike` | more than 25 USB blocks in 15 m | warning |
| `SemSoftwareViolationsHigh` | more than 50 violations for 1 h | info |
| `SemAgentCheckinsStalled` | devices enrolled but zero check-ins for 15 m | critical |
| `SemOnlineDevicesDrop` | online devices below 50 % of yesterday's peak | warning |

Each alert has a matching procedure in [RUNBOOK.md](RUNBOOK.md).

---

## Log shipping

| Source | Format | Where |
|---|---|---|
| backend api and worker | JSON (pino), one line per request or event, with `requestId` | container stdout |
| nginx | JSON access log (`sem_json` format: request id, upstream timing, TLS, client-cert status) | container stdout |
| frontend | text | container stdout |
| Audit trail | Database (`audit_logs`, hash-chained) | `GET /api/v1/audit/export?format=csv` |

**Docker Compose.** Logs use the `json-file` driver with rotation (10 MB × 5). To ship them, do one of the following:

- Run a collector on the host that tails `/var/lib/docker/containers/*/*-json.log`: Fluent Bit, Vector, Grafana Alloy/Promtail, the Elastic Agent or the Splunk UF. This is the recommended option because it keeps local logs.
- Or change the logging driver in a `docker-compose.override.yml` (`gelf`, `fluentd`, `awslogs`, `splunk`). With remote drivers, `docker compose logs` may stop working.

**Kubernetes.** Run a node-level collector DaemonSet (Fluent Bit, Vector or Alloy) and parse the JSON. The containers write only to stdout.

**SIEM integration.** Forward nginx and backend logs, and pull the audit trail periodically with `GET /audit/export` (filter by `from`/`to`) or subscribe a WEBHOOK alert channel. Useful detections include repeated `auth.login` failures (`sem_login_attempts_total{result!~"success"}`), IP-restriction 403s, `devices:command` usage, role or permission changes (`roles:write`), and `GET /audit/verify` returning `valid: false`.

**Retention.** Keep security logs for 1 year (or per your policy) in the SIEM. The containers themselves keep only about 50 MB each.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose up` fails: `POSTGRES_PASSWORD must be set` | `.env` missing or incomplete | `./scripts/generate-secrets.sh`, and run compose from the repository root |
| `backend` unhealthy, logs show `P1001 Can't reach database` | DB not ready, wrong `DATABASE_URL`, or special characters in the password | Check `docker compose logs postgres`. Passwords must be URL-safe (hex) or percent-encoded |
| Backend exits with an `ENCRYPTION_KEY` error | Not base64 of 32 bytes | `openssl rand -base64 32` (44 characters ending in `=`) |
| Everyone was logged out after a restart | `JWT_ACCESS_SECRET` changed | Expected after a rotation. Keep it stable otherwise |
| Users can log in but MFA fails for everyone | Clock skew, or `ENCRYPTION_KEY` changed | Enable NTP. Restore the original key (see [RUNBOOK](RUNBOOK.md)) |
| 502 from Nginx | frontend or backend container down or restarting | `docker compose ps`, then `docker compose logs --tail=200 backend frontend` |
| 429 Too Many Requests | Nginx zones or app throttler | Agents behind one NAT use per-device limits. For the console, raise `RATE_LIMIT_MAX` or the `sem_api` zone rate |
| Agents fail enrollment with a TLS error | Private CA not trusted on the endpoint, or incomplete chain in `fullchain.pem` | Deploy the CA to endpoints and include the intermediates. Check with `openssl s_client -connect sem.example.com:443 -showcerts` |
| Agents: `401` on heartbeat | Device retired, token rotated by re-enroll, or wrong `X-Device-Id` | Re-run the installer with a valid enrollment token |
| Agents: `403` on `/api/v1/agent/*` after enabling mTLS | Device certificate missing or expired, or wrong CA bundle | Check `agent-ca.pem` against `/api/v1/enrollment/ca.pem`. Re-enroll affected devices |
| `/downloads/…` returns 404 | `agent-dist` did not run or failed | `docker compose run --rm agent-dist`, then `docker compose logs agent-dist`. On Kubernetes, check the `agent-dist` initContainer logs of `sem-downloads` |
| Reports stuck in `QUEUED` | Worker down, or Redis unreachable | `docker compose logs worker`. Check the queue panel in Grafana |
| Report `COMPLETED` but the download returns 404 | api and worker do not share `/data` | Compose: both mount `app-data`. Kubernetes: `sem-data` must be **RWX** and mounted in both |
| SSO: `AADSTS50011 redirect URI mismatch` | URI differs from the app registration | Match `AZURE_AD_REDIRECT_URI` exactly (scheme, host, path, no trailing slash) |
| SSO user gets the wrong role | Group claim missing or wrong IDs | Add the groups claim (Group ID). The map keys are object IDs, not names |
| LDAP `unable to verify the first certificate` | DC certificate from a private CA | `NODE_EXTRA_CA_CERTS` (see [LDAP](#ldap--active-directory)). Do not disable verification in production |
| Pods `CreateContainerConfigError` | Secret `sem-secrets` missing, or a missing key | `kubectl -n secureendpoint describe pod …`. Create the secret with all keys |
| Pods blocked by PodSecurity | Image runs as root | The images must run as non-root UIDs (backend 1000, frontend 1001). See [Image expectations](../deploy/k8s/README.md#image-expectations) |
| `sem-migrate` Job fails | DB unreachable (NetworkPolicy or firewall), or insufficient DB privileges | `kubectl -n secureendpoint logs job/sem-migrate`. Allow egress to the DB CIDR. The DB role needs DDL rights |
| HPA shows `<unknown>` | metrics-server missing | Install metrics-server |

Still stuck? Collect `docker compose ps`, `docker compose logs --since 1h backend worker nginx` (or `kubectl get events`), and the `requestId` from the error response, then open an issue. Never include `.env` contents.
