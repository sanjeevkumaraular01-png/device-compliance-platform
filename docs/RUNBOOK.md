# SecureEndpoint Manager — Operations Runbook

Numbered, copy-paste procedures for operating SecureEndpoint Manager on **Docker Compose**
and **Kubernetes**. Security background for each control is in [SECURITY.md](SECURITY.md);
the API is specified in [API.md](API.md). Deployment and upgrades are covered in
[DEPLOYMENT.md](DEPLOYMENT.md) and environment variables in [ENVIRONMENT.md](ENVIRONMENT.md).

Where a step depends on backend behavior that [API.md](API.md) does not specify, it is
marked **implementation-defined**; confirm against the release notes of the version you run.

---

## Contents

- [Conventions](#conventions)
- [API down](#api-down)
- [Worker / queue backlog](#worker--queue-backlog)
- [Rotate secrets](#rotate-secrets)
- [Revoke a device](#revoke-a-device)
- [Internal CA rotation](#internal-ca-rotation)
- [Backup & restore](#backup--restore)
- [Incident response for a CRITICAL alert](#critical-alert)
- [Lost or stolen device](#lost-or-stolen-device)
- [Suspected account compromise](#suspected-account-compromise)
- [Failed alert deliveries](#failed-alert-deliveries)
- [Certificate (TLS) expiry](#certificate-tls-expiry)
- [Database maintenance](#database-maintenance)
- [Log locations](#log-locations)

---

## Conventions

| Item | Docker Compose | Kubernetes |
|---|---|---|
| Working directory | Repository root (contains `docker-compose.yml`, `.env`) | Any, with `kubectl` context set |
| Services / workloads | `postgres`, `redis`, `backend` (api), `worker`, `frontend`, `nginx`, `agent-dist` | Namespace `secureendpoint`; Deployments `sem-api`, `sem-worker`, `sem-frontend`, `sem-downloads`; Job `sem-migrate`; Secret `sem-secrets`; PVC `sem-data`; optional StatefulSets `sem-postgres`, `sem-redis` |
| Shared `/data` volume | `app-data` (Docker volume `secureendpoint_app-data` with the default project name) | PVC `sem-data` (ReadWriteMany) |

Shell setup used throughout:

```bash
export DOMAIN=sem.example.com
export API=https://$DOMAIN/api/v1
alias k='kubectl -n secureendpoint'

# Obtain an access token (valid 15 minutes). Accounts in SECURITY_MFA_REQUIRED_ROLES
# get {"mfaRequired":true,"mfaToken":...} first.
curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"secadmin@example.com","password":"..."}' | tee /tmp/login.json
MFA_TOKEN=$(jq -r .mfaToken /tmp/login.json)
export TOKEN=$(curl -fsS -X POST "$API/auth/mfa/verify" -H 'Content-Type: application/json' \
  -d "{\"mfaToken\":\"$MFA_TOKEN\",\"code\":\"123456\"}" | jq -r .accessToken)
rm -f /tmp/login.json

H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
```

Examples use `curl "${H[@]}" ...`. Every console action is recorded in the audit trail
under your account, so use a personal account, never a shared one.

---

<a id="api-down"></a>
## API down

**Triggers:** `SemApiDown` (critical, no api target up for 2 min), `SemApiInstanceDown`,
`SemHighErrorRate`, console shows network errors, `502`/`504` from Nginx.

1. Confirm from outside:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN/api/v1/health
   curl -sS https://$DOMAIN/api/v1/health/ready     # checks DB + Redis
   ```
   `health` failing = process down or proxy broken; `health` OK but `ready` failing =
   PostgreSQL or Redis problem (go to step 4).
2. Check service state.
   - Compose:
     ```bash
     docker compose ps
     docker compose logs --tail=200 backend
     docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' $(docker compose ps -q backend)
     ```
   - Kubernetes:
     ```bash
     k get pods -l app.kubernetes.io/name=sem-api -o wide
     k describe deployment sem-api
     k logs deploy/sem-api --tail=200
     k logs <pod> --previous --tail=200     # after a crash loop
     k get events --sort-by=.lastTimestamp | tail -30
     ```
3. Check the api from inside its network (bypasses Nginx):
   ```bash
   docker compose exec backend node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(async r=>console.log(r.status, await r.text()))"
   k exec deploy/sem-api -- node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(async r=>console.log(r.status, await r.text()))"
   ```
   If this succeeds but step 1 fails, the fault is in Nginx / ingress-nginx:
   `docker compose logs --tail=100 nginx` and `docker compose exec nginx nginx -t`, or
   `kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=100`.
4. Check dependencies:
   ```bash
   docker compose exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -h 127.0.0.1'
   docker compose exec redis redis-cli ping
   k exec sem-postgres-0 -- pg_isready -U sem -d secureendpoint -h 127.0.0.1   # in-cluster only
   k exec sem-redis-0 -- sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
   ```
   For managed services, check the provider console and connectivity from the namespace
   (NetworkPolicy `backend-egress` must allow the DB/Redis CIDR and port).
5. Common causes and fixes:

   | Symptom in logs | Cause | Fix |
   |---|---|---|
   | Compose refuses to start: `... must be set` | Missing variable in `.env` | Restore `.env` from the vault; never regenerate `ENCRYPTION_KEY` |
   | Prisma migration error at startup | Failed `prisma migrate deploy` (`RUN_MIGRATIONS=true` in Compose; Job `sem-migrate` in k8s) | Compose: `docker compose logs backend`, fix, `docker compose up -d backend`. K8s: `k logs job/sem-migrate`; see [DEPLOYMENT.md](DEPLOYMENT.md#upgrades) |
   | `ECONNREFUSED ...:5432` / `:6379`, auth failures | DB/Redis down or password mismatch after a rotation | Step 4; compare `DATABASE_URL`/`REDIS_URL` with the actual passwords |
   | `EACCES` / `EROFS` on `/data` | Volume not mounted or wrong ownership; PVC not bound | `k get pvc sem-data`; the api runs as UID 1000 |
   | `OOMKilled` true | Memory limit hit | Raise limits (Compose `deploy.resources`, k8s overlay `resources-*.yaml`); investigate the request pattern |
   | High event-loop lag (`SemEventLoopLag`) | CPU saturation, heavy exports | Scale out; check `/metrics` latency histogram by route |

6. Restart / roll back:
   ```bash
   docker compose up -d backend              # recreate with current config
   docker compose restart backend nginx
   k rollout restart deployment/sem-api && k rollout status deployment/sem-api
   k rollout undo deployment/sem-api         # if a new release caused it
   ```
   An image rollback does not roll back database migrations; see [DEPLOYMENT.md](DEPLOYMENT.md#upgrades).
7. Verify: step 1 returns `200` for both endpoints, the console loads, agents resume
   (`sem_agent_checkins_total` increasing), and the alert resolves.

---

## Worker / queue backlog

**Triggers:** `SemWorkerDown`, `SemQueueBacklog` (> 500 waiting/delayed for 15 min),
`SemQueueFailedJobs` (> 50 failed), reports stuck in `QUEUED`, compliance not re-evaluating,
alerts not delivered. Queues: `compliance`, `reports`, `alerts`, `maintenance`.

1. Check the worker is running and healthy:
   ```bash
   docker compose ps worker && docker compose logs --tail=200 worker
   k get pods -l app.kubernetes.io/name=sem-worker && k logs deploy/sem-worker --tail=200
   ```
2. Read queue depth from metrics:
   ```bash
   docker compose exec worker node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('sem_queue_jobs')).join('\n')))"
   k exec deploy/sem-worker -- node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('sem_queue_jobs')).join('\n')))"
   ```
3. Inspect Redis directly (BullMQ keys; the default `bull:` prefix is assumed — the
   prefix is implementation-defined):
   ```bash
   docker compose exec redis sh -c 'for q in compliance reports alerts maintenance; do echo "$q wait=$(redis-cli LLEN bull:$q:wait) active=$(redis-cli LLEN bull:$q:active) delayed=$(redis-cli ZCARD bull:$q:delayed) failed=$(redis-cli ZCARD bull:$q:failed)"; done'
   docker compose exec redis redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human'
   ```
   Kubernetes (in-cluster Redis): prefix the same commands with
   `k exec sem-redis-0 -- sh -c 'export REDISCLI_AUTH="$REDIS_PASSWORD"; ...'`.
4. Diagnose:
   - **Worker down or crash-looping:** fix the root cause from the logs (usually DB/Redis
     connectivity or `/data` not writable), then restart.
   - **Redis at `maxmemory`:** with `noeviction`, new jobs are rejected. Free memory by
     removing old completed/failed jobs through the backend's maintenance mechanism
     (implementation-defined) or raise `--maxmemory` and the container limit.
   - **Failed jobs rising in one queue:** read the error in worker logs. `alerts` failures
     are covered in [Failed alert deliveries](#failed-alert-deliveries); `reports` failures
     also set `reports.status=FAILED` with `error`.
   - **Compliance storm** (for example after a policy update or `POST /compliance/evaluate`
     with no device IDs): the backlog drains on its own; scale workers to speed it up.
5. Scale out:
   ```bash
   docker compose up -d --scale worker=3
   k scale deployment/sem-worker --replicas=3
   ```
   `sem-worker` has a HorizontalPodAutoscaler; if it overrides manual scaling, raise its
   minimum instead: `k patch hpa sem-worker -p '{"spec":{"minReplicas":3}}'`.
6. Restart without losing jobs (jobs are persisted in Redis with AOF):
   ```bash
   docker compose restart worker
   k rollout restart deployment/sem-worker
   ```
7. Verify: `sem_queue_jobs{state="waiting"}` trending down, reports reaching `COMPLETED`
   (`curl "${H[@]}" "$API/reports?pageSize=5"`), and the alert resolves.

---

<a id="rotate-secrets"></a>
## Rotate secrets

General rules: rotate one secret at a time; keep the previous value in the vault until
verified; record the change in your change log. In Compose, edit `.env` and recreate the
affected services with `docker compose up -d <services>` (a plain `restart` does **not**
reload `.env`). In Kubernetes, update `sem-secrets` (or its External Secrets / Sealed
Secrets source) and restart the Deployments:

```bash
# Patch a single key (stringData takes the plain value)
k patch secret sem-secrets --type merge -p '{"stringData":{"KEY_NAME":"new-value"}}'
# External Secrets Operator: update the backing store, then force a sync
k annotate externalsecret <your-externalsecret-name> force-sync=$(date +%s) --overwrite
k rollout restart deployment/sem-api deployment/sem-worker
```

### JWT_ACCESS_SECRET

Effect: all **access tokens** become invalid at once. Refresh tokens are stored as hashes
in `sessions` and keep working, so console users are transparently re-issued tokens on
the next refresh. In-flight MFA challenges (`mfaToken`) may also fail if they are signed
with the same secret (implementation-defined); users simply log in again.

1. Generate: `openssl rand -base64 48`.
2. Compose: set `JWT_ACCESS_SECRET=` in `.env`, then `docker compose up -d backend worker`.
   Kubernetes: patch `JWT_ACCESS_SECRET` in `sem-secrets` and restart `sem-api` and `sem-worker`.
3. All replicas must have the new value; mixed values cause random `401`s during rollout.
4. Verify: log in to the console; `GET $API/auth/me` returns `200`.

Use this also as an emergency "kill all access tokens" switch during account compromise.

### PostgreSQL password

`POSTGRES_PASSWORD` only takes effect when the data directory is first initialized;
changing it later requires `ALTER ROLE`.

1. Generate a URL-safe value: `openssl rand -hex 24`.
2. Change it in the database:
   ```bash
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   # at the psql prompt:  \password sem
   ```
   Kubernetes in-cluster: `k exec -it sem-postgres-0 -- psql -U sem -d secureendpoint`, then
   `\password sem`. Managed database: change it in the provider console.
3. Update configuration immediately (the api and worker keep existing pooled connections
   until restarted, then fail to reconnect with the old value):
   - Compose: set `POSTGRES_PASSWORD` in `.env` (and `DATABASE_URL` if set explicitly),
     then `docker compose up -d backend worker` (plus `postgres-exporter` if monitoring is enabled).
   - Kubernetes: patch `DATABASE_URL` (and `POSTGRES_PASSWORD` for the StatefulSet), then
     restart `sem-api` and `sem-worker`.
4. Verify `GET /api/v1/health/ready`.

### Redis password

Redis reads `--requirepass` from the command line, so a Redis restart is required; queued
jobs survive thanks to AOF persistence.

1. Generate: `openssl rand -hex 24`.
2. Compose: set `REDIS_PASSWORD` in `.env` (and `REDIS_URL` if explicit), then
   `docker compose up -d redis backend worker` (plus `redis-exporter`).
3. Kubernetes in-cluster: patch `REDIS_PASSWORD` and `REDIS_URL`, then
   `k rollout restart statefulset/sem-redis deployment/sem-api deployment/sem-worker`.
   Managed Redis: rotate in the provider (use dual-password/auth-token rotation if offered), then patch `REDIS_URL` and restart.
4. Verify `/health/ready` and that `sem_queue_jobs` is reported.

### SMTP, Twilio, LDAP bind and SSO client secrets

Variables: `SMTP_PASSWORD` (and `SMTP_USER`), `TWILIO_AUTH_TOKEN`, `LDAP_BIND_PASSWORD`,
`AZURE_AD_CLIENT_SECRET`, `OIDC_CLIENT_SECRET`.

1. Create the new credential at the provider **before** revoking the old one (Azure AD and
   most OIDC providers allow two client secrets concurrently; Twilio supports a secondary auth token).
2. Update `.env` or `sem-secrets`; recreate/restart `backend` and `worker`
   (`sem-api` and `sem-worker`). Alerts are delivered by the worker; SSO and LDAP logins by the api.
3. Verify:
   ```bash
   curl "${H[@]}" -X POST "$API/alerts/channels/$CHANNEL_ID/test"       # one per channel type
   curl -fsS "$API/auth/sso/providers"                                   # SSO still configured
   ```
   Then complete one SSO login and one LDAP login in the console.
4. Revoke the old credential at the provider.

Slack/Teams webhook URLs and webhook HMAC secrets are stored per channel (encrypted), not
in the environment: rotate them with `PATCH /alerts/channels/:id` and a new `config`.

### ENCRYPTION_KEY

`ENCRYPTION_KEY` protects `users.mfa_secret_enc`, `alert_channels.config_enc` and
`software_whitelist.license_key_enc` (AES-256-GCM). Changing it makes existing ciphertext
unreadable. **No built-in re-encryption command is documented.** Rotation must be performed
with a backend-provided maintenance procedure that decrypts with the old key and
re-encrypts with the new one; until your release ships such a procedure, treat
`ENCRYPTION_KEY` as a long-lived key and protect it accordingly.

If the key must be replaced anyway (for example it was exposed), use this safe interim process:

1. Inventory what will be lost:
   ```bash
   curl "${H[@]}" "$API/users?pageSize=200" | jq -r '.data[] | select(.mfaEnabled) | "\(.id) \(.email)"' > mfa-users.txt
   curl "${H[@]}" "$API/alerts/channels" > channels.json          # config is masked; re-enter from your records
   curl "${H[@]}" "$API/software/whitelist?pageSize=200" > whitelist.json
   ```
   Collect the plaintext channel configs (recipients, webhook URLs, HMAC secrets) and
   license keys from their original sources.
2. Take a full backup ([Backup & restore](#backup--restore)) and keep the **old** key with it.
3. Announce a maintenance window: MFA users must re-enroll.
4. Set the new key (`openssl rand -base64 32`) in `.env` / `sem-secrets` and restart
   `backend` and `worker` (`sem-api`, `sem-worker`). All replicas must use the same key.
5. Reset MFA for every affected user, which clears the unreadable secret:
   ```bash
   while read -r id email; do
     curl "${H[@]}" -X POST "$API/users/$id/reset-mfa" && echo "reset $email"
   done < mfa-users.txt
   ```
   The resetting administrator is also affected: have a second `SUPER_ADMIN` reset them,
   or reset yourself last in the same session. Users in `SECURITY_MFA_REQUIRED_ROLES` are
   forced to re-enroll at next login.
6. Re-enter every alert channel config with `PATCH /alerts/channels/:id` (`{"config":{...}}`)
   and test each with `POST /alerts/channels/:id/test`.
7. Re-enter license keys with `PATCH /software/whitelist/:id` (`{"licenseKey":"..."}`).
8. Verify: MFA login works, all channels test successfully, `GET /audit/verify` is valid.
9. Destroy the old key only after the retention period of backups encrypted with it has expired.

### Other credentials

- **Seed admin:** `SEED_ADMIN_PASSWORD` is only used by the seed. Change the admin
  password with `POST /auth/change-password`.
- **Grafana:** change `GRAFANA_ADMIN_PASSWORD` in the Grafana UI (the variable only seeds a new data volume).
- **Agent tokens** rotate on re-enrollment; **enrollment tokens** are rotated by revoking
  (`DELETE /enrollment/tokens/:id`) and creating new ones.
- **Internal CA:** see [Internal CA rotation](#internal-ca-rotation).

---

## Revoke a device

1. Identify the device:
   ```bash
   curl "${H[@]}" "$API/devices?search=LAPTOP-0421" | jq '.data[] | {id, deviceName, serialNumber, status, assignedUser}'
   export DEVICE_ID=<uuid>
   ```
2. **Quarantine** (reversible) if you need time to investigate:
   ```bash
   curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/quarantine"
   curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/release"      # to undo
   ```
   Status becomes `QUARANTINED`. What the agent enforces locally while quarantined is
   implementation-defined; do not rely on quarantine alone to cut network access.
3. **Retire** (revokes the agent token and certificates):
   ```bash
   curl "${H[@]}" -X DELETE "$API/devices/$DEVICE_ID"
   ```
   Status becomes `RETIRED`; the agent receives `401` on its next call. Avoid `?hard=true`
   (SUPER_ADMIN only) during incidents: it removes the record you may need as evidence.
4. **Revoke enrollment tokens** the device could reuse. Re-enrolling with the same serial
   number rotates the token and certificate, so a still-valid enrollment token on the
   endpoint could bring it back (whether a `RETIRED` device may re-enroll is
   implementation-defined):
   ```bash
   curl "${H[@]}" "$API/enrollment/tokens" | jq '(.data // .)[] | {id, name, tokenPrefix, usedCount, maxUses, expiresAt, revokedAt}'
   curl "${H[@]}" -X DELETE "$API/enrollment/tokens/$TOKEN_ID"
   ```
   Also reject unexpected re-enrollment attempts: `GET /enrollment/pending`, then
   `POST /enrollment/devices/:id/reject`.
5. Verify: `GET /devices/$DEVICE_ID` shows `RETIRED`; `GET /devices/$DEVICE_ID/timeline`
   contains the retire entry; the device no longer increments `lastSeenAt`.

---

<a id="internal-ca-rotation"></a>
## Internal CA rotation

The device CA lives in `/data/pki/ca.crt` and `/data/pki/ca.key` on the shared volume
(Compose `app-data`, k8s PVC `sem-data`). How the backend creates the CA (for example
automatically on first start when the files are absent), the certificate validity
periods and whether it accepts an operator-supplied CA are implementation-defined;
confirm before rotating.

### Back up the CA

```bash
# Compose
docker run --rm -v secureendpoint_app-data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar czf /backup/pki-$(date +%Y%m%d-%H%M%S).tgz -C /data pki
# Kubernetes (requires tar in the image; otherwise use the helper pod in Backup & restore)
k exec deploy/sem-api -- tar czf - -C /data pki > pki-$(date +%Y%m%d-%H%M%S).tgz
```

Store the archive encrypted, separately from database dumps.

### Planned rotation

1. Back up `/data/pki` (above) and take a database backup.
2. Record the current CA: `curl -fsS https://$DOMAIN/api/v1/enrollment/ca.pem -o ca-old.pem`.
3. If mTLS is enforced, first build a **bundle** containing old and new CA certificates so
   both generations of device certificates are accepted during the transition.
4. Install the new CA in `/data/pki` (move the old files aside inside the volume, then let
   the backend generate new ones or place the new pair, per your backend version), and
   restart `backend` and `worker` (`k rollout restart deployment/sem-api deployment/sem-worker`).
5. Fetch the new CA: `curl -fsS https://$DOMAIN/api/v1/enrollment/ca.pem -o ca-new.pem`;
   `cat ca-old.pem ca-new.pem > agent-ca-bundle.pem`; update the proxy (see below).
6. Re-enroll agents: create an enrollment token, get the install command
   (`GET /enrollment/install-command?tokenId=&platform=`) and run it on each endpoint
   through your software distribution tool. Re-enrollment with the same serial rotates
   the agent token and issues a certificate from the new CA. No remote re-enroll command
   is documented.
7. Track progress: devices whose newest certificate predates the rotation still need to re-enroll:
   ```sql
   SELECT d.device_name, max(c.issued_at) AS latest_cert
   FROM devices d LEFT JOIN device_certificates c ON c.device_id = d.id AND c.revoked_at IS NULL
   WHERE d.status <> 'RETIRED'
   GROUP BY d.device_name HAVING max(c.issued_at) < '2026-10-01' OR max(c.issued_at) IS NULL;
   ```
8. When complete, replace the bundle with `ca-new.pem` only and securely destroy the old key.

### Emergency rotation (CA key compromise)

An attacker with `ca.key` can mint certificates that pass proxy mTLS; they still need a
valid agent token to call the API. Act immediately:

1. Preserve evidence (copy of `/data/pki`, audit export, access logs), then install a new
   CA as in steps 4-5 above.
2. Set the proxy CA bundle to the **new CA only**. All existing agents fail mTLS and go
   offline; `/api/v1/agent/enroll` is outside mTLS, so re-enrollment still works.
3. Revoke all enrollment tokens (`DELETE /enrollment/tokens/:id`), create new, short-lived
   tokens with `autoApprove=false`, and re-enroll the fleet; approve devices via
   `GET /enrollment/pending` and `POST /enrollment/devices/:id/approve`.
4. Investigate how the key was accessed (volume, backups, host) and follow
   [Incident response](#critical-alert).

### Update the mTLS CA bundle

- **Nginx (Compose):** the file lives in `TLS_CERT_DIR` (default `./deploy/nginx/certs`),
  mounted at `/etc/nginx/certs`:
  ```bash
  cp agent-ca-bundle.pem deploy/nginx/certs/agent-ca.pem
  docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
  ```
- **ingress-nginx:**
  ```bash
  k create secret generic sem-agent-ca --from-file=ca.crt=agent-ca-bundle.pem \
    --dry-run=client -o yaml | kubectl apply -f -
  ```
  The controller picks up the change automatically; verify with an agent heartbeat.

---

<a id="backup--restore"></a>
## Backup & restore

What to back up: PostgreSQL (all state and the audit chain), the `/data` volume (reports
and **the internal CA key**), and the secrets (`.env` or `sem-secrets`, especially
`ENCRYPTION_KEY`). Redis holds transient queue state and does not need backup. See
[DEPLOYMENT.md](DEPLOYMENT.md#backups) for scheduling.

### Backup

1. Database.
   - Compose (same as `make backup`):
     ```bash
     mkdir -p backups
     docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
       > backups/sem-$(date +%Y%m%d-%H%M%S).dump
     ```
   - Kubernetes, in-cluster StatefulSet:
     ```bash
     k exec sem-postgres-0 -- pg_dump -U sem -d secureendpoint -Fc > sem-$(date +%Y%m%d-%H%M%S).dump
     ```
   - Managed PostgreSQL: use provider snapshots / PITR, plus a logical dump from a bastion.
     Remove the Prisma-only `schema=public` query parameter first (libpq rejects it):
     `pg_dump "postgresql://sem:...@host:5432/secureendpoint?sslmode=require" -Fc -f sem.dump`.
2. `/data` volume.
   - Compose:
     ```bash
     docker run --rm -v secureendpoint_app-data:/data:ro -v "$PWD/backups:/backup" alpine \
       tar czf /backup/app-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .
     ```
   - Kubernetes: use a storage-level snapshot of the `sem-data` volume, or the helper pod
     below (compliant with PSA `restricted`; runs as UID 1000 like the api):
     ```bash
     cat <<'EOF' | kubectl -n secureendpoint apply -f -
     apiVersion: v1
     kind: Pod
     metadata: { name: sem-data-helper }
     spec:
       automountServiceAccountToken: false
       securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: RuntimeDefault } }
       containers:
         - name: helper
           image: busybox:1.36
           command: ["sleep", "3600"]
           securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } }
           volumeMounts: [{ name: data, mountPath: /data }]
       volumes: [{ name: data, persistentVolumeClaim: { claimName: sem-data } }]
     EOF
     k wait --for=condition=Ready pod/sem-data-helper
     k exec sem-data-helper -- tar czf - -C /data . > app-data-$(date +%Y%m%d-%H%M%S).tgz
     k delete pod sem-data-helper
     ```
3. Secrets: confirm the vault copy of `.env` / `sem-secrets` matches production.
4. Encrypt backups and store them off-host; keep the CA archive and `ENCRYPTION_KEY` in a
   different location from the database dump.
5. Test a restore at least quarterly.

### Restore

Order: **secrets, then database, then `/data`, then applications, then verification.**

1. Restore secrets. `ENCRYPTION_KEY` must be the value in use when the dump was taken.
2. Stop writers:
   ```bash
   docker compose stop backend worker frontend nginx
   k scale deployment/sem-api deployment/sem-worker --replicas=0
   ```
   The HPAs do not scale a Deployment up from zero; scale it back manually in step 5.
3. Restore the database:
   ```bash
   docker compose up -d postgres
   docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
     < backups/sem-YYYYMMDD-HHMMSS.dump
   k exec -i sem-postgres-0 -- pg_restore -U sem -d secureendpoint --clean --if-exists --no-owner \
     < sem-YYYYMMDD-HHMMSS.dump
   ```
4. Restore `/data` (includes `pki/`):
   ```bash
   docker run --rm -v secureendpoint_app-data:/data -v "$PWD/backups:/backup:ro" alpine \
     sh -c 'tar xzf /backup/app-data-YYYYMMDD-HHMMSS.tgz -C /data && chown -R 1000:1000 /data'
   k exec -i sem-data-helper -- tar xzf - -C /data < app-data-YYYYMMDD-HHMMSS.tgz   # helper pod from above
   ```
   The `chown` assumes the backend runs as UID 1000 (as in the Kubernetes manifests).
5. Start applications. Pending migrations for a newer image are applied on start
   (Compose `RUN_MIGRATIONS=true`; in Kubernetes re-run Job `sem-migrate` first):
   ```bash
   docker compose up -d
   k delete job sem-migrate --ignore-not-found   # then re-apply the overlay to recreate it
   k scale deployment/sem-api deployment/sem-worker --replicas=2
   ```
6. Verify:
   ```bash
   curl -fsS https://$DOMAIN/api/v1/health/ready
   curl "${H[@]}" "$API/audit/verify"          # expect {"valid":true,...}
   curl "${H[@]}" "$API/dashboard/summary" | jq '{totalDevices, onlineDevices}'
   curl -fsS https://$DOMAIN/api/v1/enrollment/ca.pem | openssl x509 -noout -fingerprint -sha256
   ```
   The CA fingerprint must match the pre-incident CA, otherwise agents with mTLS fail.
   A test MFA login and `POST /alerts/channels/:id/test` confirm `ENCRYPTION_KEY` is correct.
7. Agents re-sync on their next heartbeat. Data received between the backup and the
   restore is lost; agents resend full state on the next report interval.

---

<a id="critical-alert"></a>
## Incident response for a CRITICAL alert

Applies to application alerts with `severity=CRITICAL` (for example
`DISK_ENCRYPTION_DISABLED`, `ANTIVIRUS_MISSING`, `NOT_COMPANY_DEVICE`) and to the
Prometheus alert `SemCriticalRiskDevices`. Platform availability alerts (`SemApiDown`,
`SemWorkerDown`, `SemPostgresDown`, `SemRedisDown`) are handled in [API down](#api-down)
and [Worker / queue backlog](#worker--queue-backlog).

**1. Triage (first 15 minutes)**

```bash
curl "${H[@]}" "$API/alerts?status=OPEN&severity=CRITICAL" | jq '.data[] | {id, category, title, deviceId, occurrences, createdAt}'
export ALERT_ID=<uuid> DEVICE_ID=<uuid>
curl "${H[@]}" "$API/alerts/$ALERT_ID"                        # includes deliveries
curl "${H[@]}" -X POST "$API/alerts/$ALERT_ID/acknowledge"    # signals ownership
curl "${H[@]}" "$API/devices/$DEVICE_ID" | jq '{deviceName, status, riskLevel, complianceState, assignedUser, lastSeenAt, counts}'
curl "${H[@]}" "$API/devices/$DEVICE_ID/compliance" | jq '.[0].findings[] | select(.passed==false)'
curl "${H[@]}" "$API/devices/$DEVICE_ID/security"
curl "${H[@]}" "$API/devices/$DEVICE_ID/timeline"
curl "${H[@]}" "$API/devices/$DEVICE_ID/usb-events?pageSize=50"
curl "${H[@]}" "$API/devices/$DEVICE_ID/software?pageSize=200" | jq '.data[] | select(.status!="APPROVED")'
```

Decide: misconfiguration or drift (remediate) versus suspected compromise or data
exfiltration (contain first). Open an incident ticket and record times in UTC.

**2. Containment**

```bash
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/quarantine"
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/commands" -d '{"type":"LOCK_SCREEN","payload":{}}'
# Revoke temporary USB access for this device (the list endpoint filters by status only)
curl "${H[@]}" "$API/usb/requests?status=APPROVED&pageSize=200" \
  | jq -r --arg d "$DEVICE_ID" '.data[] | select(.deviceId==$d) | .id' \
  | while read -r id; do curl "${H[@]}" -X POST "$API/usb/requests/$id/revoke"; done
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/commands" -d '{"type":"REFRESH_USB_RULES","payload":{}}'
```

Commands are delivered on the next heartbeat (default `checkinIntervalSec` 300 s); check
delivery with `GET /devices/$DEVICE_ID/commands` (`SENT`, then `SUCCEEDED`/`FAILED`).
Whether a quarantined device still receives commands is implementation-defined, so
confirm delivery. If the assigned user's account may be involved, follow
[Suspected account compromise](#suspected-account-compromise). If the device is lost, follow
[Lost or stolen device](#lost-or-stolen-device). Network isolation beyond this platform
(EDR isolation, NAC, VPN revocation) must be done in those tools.

**3. Eradication**

- Unauthorized software: `curl "${H[@]}" -X POST "$API/software/uninstall" -d '{"deviceIds":["'$DEVICE_ID'"],"name":"<name>"}'`; add it to the blacklist if appropriate.
- Encryption disabled: `{"type":"ENABLE_ENCRYPTION","payload":{}}` command.
- Missing critical patches: `curl "${H[@]}" -X POST "$API/patches/deploy" -d '{"deviceIds":["'$DEVICE_ID'"],"severity":["CRITICAL"]}'`.
- Antivirus/EDR missing: reinstall through your EDR tooling.
- Reimage the endpoint if compromise is confirmed, then re-enroll it.

**4. Recovery**

```bash
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/commands" -d '{"type":"COLLECT_INVENTORY","payload":{}}'
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/evaluate" | jq '{state, riskLevel, score}'
curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/release"
curl "${H[@]}" -X POST "$API/alerts/$ALERT_ID/resolve"
```

Compliance alerts auto-resolve when the rule passes; resolve manually only when appropriate.

**5. Evidence**

```bash
curl "${H[@]}" "$API/audit/verify"
curl "${H[@]}" -o audit-$DEVICE_ID.csv \
  "$API/audit/export?format=csv&deviceId=$DEVICE_ID&from=2026-09-20T00:00:00Z&to=2026-09-26T00:00:00Z"
sha256sum audit-$DEVICE_ID.csv > audit-$DEVICE_ID.csv.sha256
```

Also export related actors (`actorId=`) and `GET /audit/login-history?userId=`, and keep
proxy access logs for the window. Store evidence in write-once storage with the checksum.

**6. Post-incident**

Within five business days: timeline, root cause, which control failed or detected the
issue, policy or rule changes (`PATCH /policies/:id`, `PATCH /compliance/rules/:id`),
channel routing gaps, and follow-up owners. Update this runbook if a step was missing.

---

## Lost or stolen device

1. **Quarantine** immediately: `curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/quarantine"`.
2. **Lock the screen:** `curl "${H[@]}" -X POST "$API/devices/$DEVICE_ID/commands" -d '{"type":"LOCK_SCREEN","payload":{}}'`.
   It executes only when the device next checks in. Wait for delivery
   (`GET /devices/$DEVICE_ID/commands`) before step 4, because retiring revokes the agent
   token and no further commands can reach the device.
3. **Revoke USB approvals** for the device (same loop as in
   [Containment](#critical-alert)) and review device- or user-scoped whitelist entries:
   `GET /usb/devices?isWhitelisted=true`, then `DELETE /usb/devices/:id` for entries whose
   `scopeRefId` is this device or user.
4. **Retire** once the lock command is delivered, or after a set deadline (for example 24 h)
   if the device never checks in: `curl "${H[@]}" -X DELETE "$API/devices/$DEVICE_ID"`.
   Revoke any enrollment tokens that were stored on the device ([Revoke a device](#revoke-a-device)).
5. **Rotate the user's credentials and sessions:**
   - The user (from a trusted device) changes their password with `POST /auth/change-password`
     and revokes all other sessions with `DELETE /auth/sessions` (as that user):
     ```bash
     curl -H "Authorization: Bearer $USER_TOKEN" -X DELETE "$API/auth/sessions"
     ```
   - If the user cannot do this promptly, an administrator deactivates the account
     (`DELETE /users/:id`) and resets MFA (`POST /users/:id/reset-mfa`) until they can.
   - LDAP/AD and SSO users rotate their password and sessions in the identity provider.
   - Rotate other secrets that were on the device (VPN certificates, SSH keys, API tokens) in their systems.
6. **Audit:** confirm the actions are recorded and that there was no unusual activity:
   `GET /devices/$DEVICE_ID/timeline`, `GET /audit/login-history?userId=...`,
   `GET /audit/export?format=csv&deviceId=$DEVICE_ID`.
7. **Report:** note whether disk encryption was `ENABLED` at last report
   (`GET /devices/$DEVICE_ID/security`); this determines data-breach notification
   obligations. File a police report for theft and inform your DPO/legal as required.
   Update the asset record (`PATCH /devices/:id` with `notes`) for the inventory history.

---

<a id="suspected-account-compromise"></a>
## Suspected account compromise

**Triggers:** `SemLoginFailureSpike`, AUTH alerts, logins from unexpected IPs, user report.

1. Scope the activity:
   ```bash
   export USER_ID=<uuid>
   curl "${H[@]}" "$API/audit/login-history?userId=$USER_ID&from=2026-09-01T00:00:00Z" | jq '.data[] | {occurredAt, success, reason, ipAddress, userAgent, mfaUsed}'
   curl "${H[@]}" "$API/audit?actorId=$USER_ID&pageSize=200" | jq '.data[] | {occurredAt, category, action, resourceType, resourceId, ipAddress}'
   ```
2. Contain:
   ```bash
   curl "${H[@]}" -X DELETE "$API/users/$USER_ID"            # deactivate
   curl "${H[@]}" -X POST "$API/users/$USER_ID/reset-mfa"
   ```
   [API.md](API.md) has no endpoint for an administrator to revoke another user's sessions.
   Whether deactivation invalidates existing sessions is implementation-defined; access
   tokens may remain valid for up to 15 minutes. For a privileged account, rotate
   `JWT_ACCESS_SECRET` ([Rotate secrets](#rotate-secrets)) to invalidate every access token
   immediately. For SSO/LDAP accounts, disable the account and revoke sessions in the IdP.
3. Review changes the account could have made (depending on its role):
   - Role permissions (`GET /roles`) and user roles (`GET /users?roleKey=SUPER_ADMIN`).
   - Alert channels (`GET /alerts/channels`): new webhooks could exfiltrate alert data or silence notifications.
   - IP restrictions (`GET /settings/ip-restrictions`) and settings (`GET /settings`), including `mfaRequiredRoles`.
   - Enrollment tokens created (`GET /enrollment/tokens`) and devices approved (`GET /audit?category=DEVICE_CHANGE`).
   - Policies, compliance rules, USB whitelist and approvals, software whitelist, commands issued (`UNINSTALL_SOFTWARE`, `RESTART`).
   Revert unauthorized changes; each revert is audited.
4. Harden: add IP restrictions if absent, extend `SECURITY_MFA_REQUIRED_ROLES`, and review
   other accounts from the same source IPs.
5. Restore access: reactivate (`PATCH /users/:id` with `isActive: true`; the accepted PATCH
   fields are implementation-defined), `POST /users/:id/unlock`
   if locked; the user sets a new password and re-enrolls MFA.
6. Preserve evidence (`GET /audit/verify`, audit export for the actor and window) and run
   the post-incident review as in [Incident response](#critical-alert).

---

## Failed alert deliveries

**Triggers:** `SemAlertDeliveryFailures` (> 5 failures per channel in 15 min), missing
notifications, `sem_alerts_sent_total{status=~"fail.*"}` rising.

1. Identify the channel and error:
   ```bash
   curl "${H[@]}" "$API/alerts/$ALERT_ID" | jq '.deliveries'
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT c.name, c.type, d.attempts, d.error, d.created_at FROM alert_deliveries d JOIN alert_channels c ON c.id=d.channel_id WHERE d.status='\''FAILED'\'' ORDER BY d.created_at DESC LIMIT 20;"'
   docker compose logs --since=30m worker | grep -i -E 'alert|smtp|twilio|webhook'
   k logs deploy/sem-worker --since=30m | grep -i -E 'alert|smtp|twilio|webhook'
   ```
2. Send a test: `curl "${H[@]}" -X POST "$API/alerts/channels/$CHANNEL_ID/test"`.
3. Fix by channel type:

   | Type | Typical causes | Check |
   |---|---|---|
   | EMAIL | Wrong `SMTP_*`, expired password, TLS mismatch (`SMTP_SECURE` with port 465 vs STARTTLS on 587), relay rejects `SMTP_FROM` | Provider logs; rotate as in [Rotate secrets](#rotate-secrets) |
   | SMS / WHATSAPP | Twilio credentials, unverified sender (`TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`), recipient format | Twilio console error codes |
   | SLACK / TEAMS | Webhook URL revoked or channel archived | Replace URL via `PATCH /alerts/channels/:id` |
   | WEBHOOK | Receiver down, TLS error, HMAC verification failing on receiver | Receiver logs; confirm it validates `X-SEM-Signature` with the configured secret |
   | Any (Kubernetes) | Egress blocked by NetworkPolicy `backend-egress` (only 443/465/587/636 allowed) or egress proxy | Use an allowed port or extend the policy |

4. After a fix, restart the worker if environment variables changed. Automatic retry of
   failed deliveries (attempt count, backoff) is implementation-defined; there is no
   documented redelivery endpoint. For critical alerts that were missed, notify
   responders manually with the alert details from `GET /alerts?status=OPEN&severity=CRITICAL`.
5. Verify the metric stops increasing and a test message arrives on every channel.

---

<a id="certificate-tls-expiry"></a>
## Certificate (TLS) expiry

1. Check the public certificate:
   ```bash
   echo | openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -subject -enddate
   ```
   Renew at least 14 days before `notAfter`.
2. **Compose** (files `fullchain.pem` and `privkey.pem` in `TLS_CERT_DIR`, default `./deploy/nginx/certs`):
   - The HTTP server block serves ACME HTTP-01 challenges from `/var/www/certbot`, but
     `docker-compose.yml` does not mount that path; use an override file that mounts a
     webroot there, or use certbot's DNS-01 challenge.
   - Install renewed files and reload without downtime:
     ```bash
     cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/privkey.pem deploy/nginx/certs/
     chmod 600 deploy/nginx/certs/privkey.pem
     docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
     ```
   - Self-signed (lab only): `make certs`.
3. **Kubernetes** (cert-manager, secret `sem-tls`, issuer `letsencrypt-prod`):
   ```bash
   k get certificate
   k describe certificate sem-tls
   k get certificaterequest,order,challenge
   cmctl renew -n secureendpoint sem-tls      # force renewal if needed
   ```
   Typical failures: HTTP-01 challenge blocked, DNS not pointing at the ingress, ClusterIssuer
   rate limits (see `deploy/k8s/examples/cluster-issuer.yaml`).
4. **Device certificates:** issued at enrollment with an implementation-defined validity.
   Find those expiring soon and re-enroll the affected devices:
   ```sql
   SELECT d.device_name, c.serial_number, c.expires_at
   FROM device_certificates c JOIN devices d ON d.id = c.device_id
   WHERE c.revoked_at IS NULL AND d.status <> 'RETIRED' AND c.expires_at < now() + interval '30 days'
   ORDER BY c.expires_at;
   ```
   With mTLS enforced, an expired device certificate stops check-ins (`SemAgentCheckinsStalled`).
5. **Internal CA certificate:** check `openssl x509 -noout -enddate` on `ca.pem` and plan an
   [Internal CA rotation](#internal-ca-rotation) well before expiry.

---

## Database maintenance

Open a psql session:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
k exec -it sem-postgres-0 -- psql -U sem -d secureendpoint        # in-cluster StatefulSet
```

1. **Size and growth:**
   ```sql
   SELECT pg_size_pretty(pg_database_size(current_database()));
   SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total, n_live_tup, n_dead_tup
   FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
   ```
   Fastest-growing tables: `audit_logs`, `compliance_results` (one row per evaluation),
   `usb_events`, `login_history`, `alert_deliveries`, `software_inventory` (rows with
   `removed_at`), `device_commands`, `patch_status`.
2. **Vacuum and statistics:** autovacuum runs by default. After large deletes or restores:
   ```sql
   VACUUM (ANALYZE, VERBOSE) compliance_results;
   ANALYZE;
   SELECT relname, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables ORDER BY relname;
   ```
   Avoid `VACUUM FULL` during business hours; it takes an exclusive lock.
3. **Disk space:** `docker system df -v` and `df -h /var/lib/docker` (Compose);
   `k get pvc` and provider metrics (Kubernetes). WAL is bounded by `max_wal_size=4GB`.
   If the disk fills, PostgreSQL stops accepting writes: extend the volume first, then clean up.
4. **Slow queries:** statements over 1 s are logged (`log_min_duration_statement=1000`):
   `docker compose logs postgres | grep duration`.
5. **Retention hints.** A built-in retention job is not documented; the `maintenance` queue's
   behavior is implementation-defined. Suggested manual policy (take a backup first):
   ```sql
   -- keep 180 days of evaluation history
   DELETE FROM compliance_results WHERE evaluated_at < now() - interval '180 days';
   DELETE FROM usb_events         WHERE occurred_at  < now() - interval '365 days';
   DELETE FROM device_commands    WHERE completed_at < now() - interval '90 days';
   ```
   Do **not** delete from `audit_logs`: removing rows breaks the hash chain and
   `GET /audit/verify` will report `valid:false`. Archive audit data with
   `GET /audit/export` instead and keep the table intact (partitioning or pruning requires
   a backend-supported procedure). Align retention with your legal requirements, and keep
   `login_history` at least as long as your security policy requires.
6. **Connections:** `max_connections=200`. Check with
   `SELECT count(*), state FROM pg_stat_activity GROUP BY state;` and scale replicas accordingly.

---

## Log locations

| Source | Docker Compose | Kubernetes |
|---|---|---|
| API (`backend`, `APP_ROLE=api`) | `docker compose logs -f backend` | `k logs deploy/sem-api -f` |
| Worker (queues, alert delivery, reports, schedulers) | `docker compose logs -f worker` | `k logs deploy/sem-worker -f` |
| Migrations | `docker compose logs backend` (startup) | `k logs job/sem-migrate` |
| Frontend | `docker compose logs -f frontend` | `k logs deploy/sem-frontend -f` |
| Reverse proxy access/error (JSON, with request ID) | `docker compose logs -f nginx` | `kubectl -n ingress-nginx logs deploy/ingress-nginx-controller` |
| Agent downloads | `docker compose logs nginx` (`/downloads/`), `docker compose logs agent-dist` | `k logs deploy/sem-downloads` |
| PostgreSQL (incl. queries > 1 s) | `docker compose logs postgres` | `k logs sem-postgres-0` or provider console |
| Redis | `docker compose logs redis` | `k logs sem-redis-0` or provider console |
| Container log files | `/var/lib/docker/containers/<id>/<id>-json.log` (rotated 10 MB x 5) | Node runtime logs / cluster log shipper |
| Prometheus alerts | Alertmanager `http://127.0.0.1:9093` (profile `monitoring`) | Your Alertmanager |
| Audit trail | `GET /audit`, `GET /audit/export` (table `audit_logs`) | same |
| Login attempts | `GET /audit/login-history` (table `login_history`) | same |
| Generated reports | `/data/reports` in `app-data` | `/data/reports` on PVC `sem-data` |
| Endpoint agent logs | On the endpoint; location defined by the agent implementation | same |

Application log format and verbosity are controlled by `LOG_LEVEL` (default `info`); the
log line format is implementation-defined. Use `X-Request-Id` from proxy logs and error
responses (`requestId`) to correlate a request across proxy and backend logs. Forward all
of these to your central log platform; Docker's local rotation keeps only about 50 MB per container.
