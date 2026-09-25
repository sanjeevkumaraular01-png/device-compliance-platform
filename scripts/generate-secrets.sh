#!/usr/bin/env bash
# Creates .env from .env.example, replacing every __GENERATE_*__ placeholder with
# a fresh cryptographically-random value.
#
#   ./scripts/generate-secrets.sh                 # writes ./.env (refuses to overwrite)
#   ./scripts/generate-secrets.sh --force         # overwrite an existing .env
#   ./scripts/generate-secrets.sh --domain sem.example.com
#   ./scripts/generate-secrets.sh --output /tmp/test.env
#
# Placeholders:
#   __GENERATE_BASE64_32__  base64 of 32 random bytes (ENCRYPTION_KEY — AES-256)
#   __GENERATE_BASE64_48__  base64 of 48 random bytes (JWT_ACCESS_SECRET)
#   __GENERATE_HEX_24__     48 hex chars (URL-safe passwords: Postgres, Redis, Grafana)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/.env.example"
OUTPUT="$ROOT/.env"
FORCE=0
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) FORCE=1; shift ;;
    -d|--domain) DOMAIN="$2"; shift 2 ;;
    -o|--output) OUTPUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$TEMPLATE" ]] || { echo "missing $TEMPLATE" >&2; exit 1; }
if [[ -f "$OUTPUT" && $FORCE -ne 1 ]]; then
  echo "$OUTPUT already exists — use --force to overwrite (this ROTATES all secrets;" >&2
  echo "never do that on a live system: ENCRYPTION_KEY protects stored data)." >&2
  exit 1
fi

rand_b64() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1" | tr -d '\n'
  else head -c "$1" /dev/urandom | base64 | tr -d '\n'; fi
}
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1" | tr -d '\n'
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
  while [[ "$line" == *__GENERATE_BASE64_32__* ]]; do line="${line/__GENERATE_BASE64_32__/$(rand_b64 32)}"; done
  while [[ "$line" == *__GENERATE_BASE64_48__* ]]; do line="${line/__GENERATE_BASE64_48__/$(rand_b64 48)}"; done
  while [[ "$line" == *__GENERATE_HEX_24__* ]];    do line="${line/__GENERATE_HEX_24__/$(rand_hex 24)}"; done
  if [[ -n "$DOMAIN" ]]; then
    line="${line//https:\/\/localhost/https://$DOMAIN}"
    [[ "$line" == DOMAIN=* ]] && line="DOMAIN=$DOMAIN"
  fi
  printf '%s\n' "$line"
done < "$TEMPLATE" > "$tmp"

mv "$tmp" "$OUTPUT"
trap - EXIT
chmod 600 "$OUTPUT" 2>/dev/null || true

echo "Wrote $OUTPUT with freshly generated secrets."
echo "Next:"
echo "  1. Review SMTP / SSO / LDAP / Twilio settings in $OUTPUT"
echo "  2. Store a copy of ENCRYPTION_KEY in your password vault — it cannot be recovered."
echo "  3. For production set SEED_DEMO_DATA=false and a strong SEED_ADMIN_PASSWORD."
