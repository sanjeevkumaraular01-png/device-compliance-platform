#!/usr/bin/env bash
# SecureEndpoint Manager — restore a backup produced by scripts/backup.sh.
# DESTRUCTIVE: overwrites the current database and application data volume.
#
# Usage:  ./scripts/restore.sh ./backups/<timestamp>
set -euo pipefail
cd "$(dirname "$0")/.."
# Robust on both Linux hosts and Windows Git Bash (Docker needs native paths).
export MSYS_NO_PATHCONV=1
hostpath() { (cd "$1" 2>/dev/null && (pwd -W 2>/dev/null || pwd)); }

SRC="${1:-}"
[ -n "$SRC" ] && [ -f "$SRC/db.sql.gz" ] && [ -f "$SRC/data.tgz" ] || {
  echo "Usage: $0 <backup-dir>   (a directory containing db.sql.gz and data.tgz)" >&2
  exit 1
}

POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || echo sem)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || echo secureendpoint)"
# The real (project-prefixed) volume name, read from the running backend container.
DATA_VOLUME="$(docker compose ps -q backend 2>/dev/null | head -1 | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null)"
DATA_VOLUME="${DATA_VOLUME:-secureendpoint_app-data}"

echo "This will OVERWRITE database '$POSTGRES_DB' and volume '$DATA_VOLUME' from: $SRC"
printf 'Type "restore" to continue: '
read -r ans
[ "$ans" = "restore" ] || { echo "Aborted."; exit 1; }

echo "==> Stopping app services (keeping postgres up) ..."
docker compose stop backend worker frontend >/dev/null 2>&1 || true

echo "==> Restoring database ..."
gunzip -c "$SRC/db.sql.gz" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "==> Restoring application data volume ..."
docker run --rm -v "$DATA_VOLUME:/data" -v "$(hostpath "$SRC"):/backup:ro" alpine \
  sh -c 'rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /backup/data.tgz -C /data'

echo "==> Restarting services ..."
docker compose up -d backend worker frontend >/dev/null

echo "==> Restore complete. Verify: docker compose ps ; curl -sk https://localhost/api/v1/health"
