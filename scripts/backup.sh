#!/usr/bin/env bash
# SecureEndpoint Manager — full backup (PostgreSQL + application data volume).
# Produces two files under ./backups/<timestamp>/:
#   db.sql.gz   — pg_dump of the whole database
#   data.tgz    — the app-data volume (reports, device CA in pki/, screenshots)
#
# Usage:  ./scripts/backup.sh [output-dir]
# Restore with ./scripts/restore.sh <timestamp-dir>.
#
# The device CA private key lives in the data volume — treat these backups as
# secret and store them encrypted, off-host.
set -euo pipefail
cd "$(dirname "$0")/.."
# Robust on both Linux hosts and Windows Git Bash (Docker needs native paths).
export MSYS_NO_PATHCONV=1
hostpath() { (cd "$1" 2>/dev/null && (pwd -W 2>/dev/null || pwd)); }

OUT_ROOT="${1:-./backups}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_ROOT/$TS"
mkdir -p "$OUT"

# DB credentials come from .env (fall back to compose defaults).
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || echo sem)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || echo secureendpoint)"
# The real (project-prefixed) volume name, read from the running backend container.
DATA_VOLUME="$(docker compose ps -q backend 2>/dev/null | head -1 | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null)"
DATA_VOLUME="${DATA_VOLUME:-secureendpoint_app-data}"

echo "==> Backing up database ($POSTGRES_DB) ..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$OUT/db.sql.gz"

echo "==> Backing up application data volume ($DATA_VOLUME) ..."
docker run --rm -v "$DATA_VOLUME:/data:ro" -v "$(cd "$OUT" && pwd):/backup" alpine \
  tar czf /backup/data.tgz -C /data .

cat > "$OUT/manifest.txt" <<EOF
SecureEndpoint Manager backup
created:  $TS
database: $POSTGRES_DB (db.sql.gz)
volume:   $DATA_VOLUME (data.tgz)
db size:  $(du -h "$OUT/db.sql.gz" | cut -f1)
data size:$(du -h "$OUT/data.tgz" | cut -f1)
EOF

echo "==> Done: $OUT"
ls -lh "$OUT"
echo "Keep this backup encrypted and off-host (it contains the device CA key and encrypted secrets)."
