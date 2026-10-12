#!/usr/bin/env bash
# Generates a self-signed TLS certificate for LOCAL / LAB use:
#   deploy/nginx/certs/fullchain.pem  and  deploy/nginx/certs/privkey.pem
#
#   ./scripts/gen-self-signed-cert.sh
#   DOMAIN=sem.lab.local DAYS=365 ./scripts/gen-self-signed-cert.sh
#   ./scripts/gen-self-signed-cert.sh --force     # overwrite existing files
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${CERT_DIR:-$ROOT/deploy/nginx/certs}"
DOMAIN="${DOMAIN:-localhost}"
DAYS="${DAYS:-825}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$OUT_DIR"
# Native path for openssl on Git Bash/MSYS (MSYS_NO_PATHCONV below disables auto-conversion)
if command -v cygpath >/dev/null 2>&1; then OUT_DIR="$(cygpath -m "$OUT_DIR")"; fi

if [[ -f "$OUT_DIR/fullchain.pem" && $FORCE -ne 1 ]]; then
  echo "$OUT_DIR/fullchain.pem exists — use --force to overwrite." >&2
  exit 1
fi

SAN="DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1,IP:::1"
[[ "$DOMAIN" == "localhost" ]] && SAN="DNS:localhost,IP:127.0.0.1,IP:::1"

# MSYS_NO_PATHCONV stops Git Bash on Windows from mangling "/CN=..." into a path.
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey ec \
  -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$OUT_DIR/privkey.pem" \
  -out "$OUT_DIR/fullchain.pem" \
  -days "$DAYS" \
  -subj "/O=SecureEndpoint Manager (self-signed)/CN=${DOMAIN}" \
  -addext "subjectAltName=${SAN}" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=serverAuth" \
  -addext "basicConstraints=critical,CA:FALSE"

chmod 600 "$OUT_DIR/privkey.pem" 2>/dev/null || true
chmod 644 "$OUT_DIR/fullchain.pem" 2>/dev/null || true

echo "Created $OUT_DIR/fullchain.pem and privkey.pem for ${DOMAIN} (valid ${DAYS} days)."
openssl x509 -in "$OUT_DIR/fullchain.pem" -noout -subject -enddate -fingerprint -sha256
