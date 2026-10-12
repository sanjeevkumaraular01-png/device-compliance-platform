#!/usr/bin/env bash
# Validates all infrastructure-as-code in the repo using throw-away containers:
#   docker compose config (core, monitoring, dev), nginx -t, promtool, amtool,
#   kustomize + kubeconform (staging & production), Grafana JSON, actionlint.
# Works on Linux/macOS and Git Bash on Windows. Requires docker.
set -euo pipefail
cd "$(dirname "$0")/.."

# Docker on Windows needs a native path for bind mounts.
ROOT="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1
TMP="$(mktemp -d)"
TMP_HOST="$( (cd "$TMP" && (pwd -W 2>/dev/null || pwd)) )"
trap 'rm -rf "$TMP"' EXIT
fail=0
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32mOK\033[0m %s\n' "$*"; }
bad()  { printf '\033[31mFAIL\033[0m %s\n' "$*"; fail=1; }

step "docker compose config"
./scripts/generate-secrets.sh --output "$TMP/test.env" >/dev/null
docker compose --env-file "$TMP_HOST/test.env" -f docker-compose.yml config -q && ok core || bad core
docker compose --env-file "$TMP_HOST/test.env" -f docker-compose.yml --profile monitoring --profile node-exporter config -q && ok monitoring || bad monitoring
docker compose --env-file "$TMP_HOST/test.env" -f docker-compose.yml -f docker-compose.dev.yml --profile ldap config -q && ok dev || bad dev

step "nginx -t"
mkdir -p "$TMP/certs"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=localhost" \
  -keyout "$TMP_HOST/certs/privkey.pem" -out "$TMP_HOST/certs/fullchain.pem" </dev/null >/dev/null 2>&1
docker run --rm \
  --add-host backend:127.0.0.1 --add-host frontend:127.0.0.1 \
  -v "$ROOT/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$ROOT/deploy/nginx/conf.d:/etc/nginx/conf.d:ro" \
  -v "$ROOT/deploy/nginx/snippets:/etc/nginx/snippets:ro" \
  -v "$TMP_HOST/certs:/etc/nginx/certs:ro" \
  nginx:1.27-alpine nginx -t && ok nginx || bad nginx

step "promtool / amtool"
docker run --rm -v "$ROOT/deploy/prometheus:/etc/prometheus:ro" --entrypoint promtool \
  prom/prometheus:v2.55.1 check config /etc/prometheus/prometheus.yml && ok prometheus.yml || bad prometheus.yml
docker run --rm -v "$ROOT/deploy/prometheus:/etc/prometheus:ro" --entrypoint promtool \
  prom/prometheus:v2.55.1 check rules /etc/prometheus/alerts.yml && ok alerts.yml || bad alerts.yml
docker run --rm -v "$ROOT/deploy/prometheus:/cfg:ro" --entrypoint amtool \
  prom/alertmanager:v0.27.0 check-config /cfg/alertmanager.yml && ok alertmanager.yml || bad alertmanager.yml

step "kustomize + kubeconform"
for overlay in staging production; do
  if docker run --rm -v "$ROOT/deploy/k8s:/k8s:ro" registry.k8s.io/kubectl:v1.31.0 \
       kustomize "/k8s/overlays/$overlay" > "$TMP_HOST/$overlay.yaml"; then
    ok "kustomize $overlay ($(grep -c "^kind:" "$TMP_HOST/$overlay.yaml") objects)"
    docker run --rm -v "$TMP_HOST:/work:ro" ghcr.io/yannh/kubeconform:latest \
      -strict -summary -ignore-missing-schemas -kubernetes-version 1.31.0 "/work/$overlay.yaml" \
      && ok "kubeconform $overlay" || bad "kubeconform $overlay"
  else
    bad "kustomize $overlay"
  fi
done

step "Grafana dashboards"
for f in deploy/grafana/dashboards/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" && ok "$f" || bad "$f"
done

step "actionlint"
# actionlint needs a repo root; copy workflows into a scratch dir with a .git marker
docker run --rm -v "$ROOT:/repo:ro" --entrypoint sh rhysd/actionlint:latest -c \
  "mkdir -p /tmp/r/.git && cp -r /repo/.github /tmp/r/ && cd /tmp/r && actionlint -color" \
  && ok actionlint || bad actionlint

echo
if [[ $fail -ne 0 ]]; then echo "Validation FAILED"; exit 1; fi
echo "All infrastructure checks passed."
