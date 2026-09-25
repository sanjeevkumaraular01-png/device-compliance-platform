# Kubernetes manifests (Kustomize)

The full step-by-step guide is in [docs/DEPLOYMENT.md → Kubernetes deployment](../../docs/DEPLOYMENT.md#kubernetes-deployment). This file describes the layout and what you need to know when you change it.

```
deploy/k8s/
├── base/                              # namespace "secureendpoint"
│   ├── kustomization.yaml             # configMapGenerator: sem-config, sem-downloads-nginx, sem-security-headers
│   ├── namespace.yaml                 # Pod Security Admission: restricted
│   ├── config.env                     # non-secret backend env (envFrom)
│   ├── secret.example.yaml            # TEMPLATE ONLY — not rendered
│   ├── serviceaccount.yaml            # sem-app, no API token
│   ├── pvc.yaml                       # sem-data (ReadWriteMany) → /data
│   ├── backend-api.yaml               # Deployment sem-api, Service "backend", PDB, HPA
│   ├── worker.yaml                    # Deployment sem-worker, headless Service sem-worker-metrics, PDB, HPA
│   ├── migration-job.yaml             # Job sem-migrate (prisma migrate deploy + seed)
│   ├── frontend.yaml                  # Deployment sem-frontend, Service "frontend", PDB, HPA
│   ├── downloads.yaml                 # Deployment sem-downloads (agent-dist initContainer + nginx-unprivileged)
│   ├── ingress.yaml                   # Ingresses sem-web, sem-auth, sem-agent, sem-downloads
│   └── networkpolicies.yaml           # default deny + explicit allows
├── components/prometheus-operator/    # ServiceMonitor + PrometheusRule (generated from deploy/prometheus/alerts.yml)
├── postgres/                          # OPTIONAL StatefulSet + Service "postgres" + NetworkPolicy
├── redis/                             # OPTIONAL StatefulSet + Service "redis" + NetworkPolicy
├── overlays/
│   ├── staging/                       # ns secureendpoint-staging, in-cluster PG/Redis, small replicas, demo data
│   └── production/                    # ns secureendpoint, managed PG/Redis, 3+ replicas, bigger resources
└── examples/                          # cert-manager ClusterIssuers, External Secrets example
```

## Render and validate

```bash
kubectl kustomize deploy/k8s/overlays/production
# without a local kubectl:
docker run --rm -v "$PWD/deploy/k8s:/k8s:ro" registry.k8s.io/kubectl:v1.31.0 kustomize /k8s/overlays/production
make k8s-validate          # both overlays + kubeconform (strict, CRDs skipped)
```

## Before the first apply

1. The namespace exists and Secret `sem-secrets` holds every key in `base/secret.example.yaml`. In production, create it with External Secrets or Sealed Secrets.
2. ingress-nginx runs in namespace `ingress-nginx`, and cert-manager has the ClusterIssuer `letsencrypt-prod` (staging overlay: `letsencrypt-staging`).
3. A ReadWriteMany StorageClass exists and is set in the overlay (`efs-sc`, `azurefile-csi-premium`, `nfs-client`, …).
4. Hostnames are replaced in the overlay: the Ingress patch and the `sem-config` literals.
5. If the Prometheus Operator CRDs are **not** installed, remove `components/prometheus-operator` from the overlay.

## Rollout order

The migration Job must finish before new api and worker pods start:

```bash
kubectl kustomize deploy/k8s/overlays/production > /tmp/sem.yaml
kubectl apply -f /tmp/sem.yaml -l 'app.kubernetes.io/component in (config)'
kubectl -n secureendpoint delete job sem-migrate --ignore-not-found
kubectl apply -f /tmp/sem.yaml -l 'app.kubernetes.io/component in (migration)'
kubectl -n secureendpoint wait --for=condition=complete job/sem-migrate --timeout=15m
kubectl apply -f /tmp/sem.yaml
```

`.github/workflows/deploy.yml` automates this, and adds signature verification, smoke tests and rollback. For Argo CD, the Job is annotated as a `PreSync` hook.

## Managed database and Redis (strongly recommended)

The `postgres/` and `redis/` directories each run a **single instance** with no replication, no PITR and no automatic failover. They suit labs, CI and staging only. **In production, use managed services:**

| | AWS | Azure | Google Cloud |
|---|---|---|---|
| PostgreSQL 16 | RDS for PostgreSQL / Aurora (Multi-AZ) | Azure Database for PostgreSQL Flexible Server (zone-redundant HA) | Cloud SQL for PostgreSQL (HA) |
| Redis 7 | ElastiCache for Redis (Multi-AZ, TLS) | Azure Cache for Redis (Standard or Premium) | Memorystore for Redis (Standard tier) |
| RWX storage for `/data` | EFS (efs-sc) | Azure Files Premium | Filestore |

Configure them as follows:

- PostgreSQL: TLS required (`sslmode=require` in `DATABASE_URL`), automated backups with PITR, encryption at rest, and a dedicated role `sem` that owns the database (the migrations need DDL rights).
- Redis: `maxmemory-policy noeviction` (BullMQ requires it), AUTH, and TLS (`rediss://`).
- Networking: narrow the `0.0.0.0/0` ipBlocks in the `backend-egress` NetworkPolicy to the managed services' CIDRs.

## Image expectations

The manifests assume the following about the component images. Verify them when the Dockerfiles change.

| Image | Assumption |
|---|---|
| backend | Runs as a non-root numeric UID **1000**. Works with a read-only root file system: writes only to `/data` and `/tmp`, and `npx prisma` uses `HOME=/tmp`. Contains `sh` and `dist/prisma/seed.js` |
| frontend | Runs as UID **1001**. Next.js standalone listens on 3000 (`HOSTNAME=0.0.0.0`). `/app/.next/cache` is writable (emptyDir) |
| agent-dist | The default entrypoint copies `/downloads/*` to `/out` and exits 0. Works as UID 101 with a read-only root file system, and the files are world-readable |
| nginx | `nginxinc/nginx-unprivileged:1.27-alpine` (UID 101, port 8080) |

If an image runs as a named user rather than a numeric UID, keep the explicit `runAsUser` values. Kubernetes cannot verify `runAsNonRoot` against a user name.

## Customising

- **Replica counts and HPA bounds**: the `replicas:` and HPA patches in the overlay.
- **Resources**: `overlays/production/resources-{api,worker,frontend}.yaml`.
- **Another environment**: copy `overlays/staging` and change `namespace`, hosts, `images` and the storage class. Also patch the `custom-headers` annotation, which references the ConfigMap namespace (`<namespace>/sem-security-headers`).
- **Agent mTLS**: see the comments on the `sem-agent` Ingress and [docs/SECURITY.md](../../docs/SECURITY.md).
