#!/usr/bin/env bash
# SecureEndpoint agent installer for Linux (systemd).
#
#   curl -fsSL https://SERVER/downloads/install.sh | sudo bash -s -- --server https://SERVER --token sem_enr_xxx
#
# Options:
#   --server URL              SecureEndpoint server (required)
#   --token TOKEN             enrollment token sem_enr_... (required)
#   --insecure-skip-verify    skip TLS verification (testing only)
#   --ca-file FILE            PEM CA used to verify the server
#   --arch amd64|arm64        override architecture detection
set -euo pipefail

SERVER=""
TOKEN=""
INSECURE=0
CA_FILE=""
ARCH=""
BIN=/usr/local/bin/sem-agent
UNIT=/etc/systemd/system/sem-agent.service

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --server=*) SERVER="${1#*=}"; shift ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    --insecure-skip-verify) INSECURE=1; shift ;;
    --ca-file) CA_FILE="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$SERVER" ] || die "--server is required"
[ -n "$TOKEN" ] || die "--token is required"
case "$TOKEN" in sem_enr_*) ;; *) die "--token must be an enrollment token (sem_enr_...)";; esac
[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"

if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "unsupported architecture $(uname -m)" ;;
  esac
fi

SERVER="${SERVER%/}"
BASE="$SERVER/downloads"
FILE="sem-agent-linux-$ARCH"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then
    local opts=(-fsSL --proto '=https,http' --retry 3)
    [ "$INSECURE" = 1 ] && opts+=(-k)
    [ -n "$CA_FILE" ] && opts+=(--cacert "$CA_FILE")
    curl "${opts[@]}" -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    local opts=(-q)
    [ "$INSECURE" = 1 ] && opts+=(--no-check-certificate)
    [ -n "$CA_FILE" ] && opts+=(--ca-certificate="$CA_FILE")
    wget "${opts[@]}" -O "$2" "$1"
  else
    die "curl or wget is required"
  fi
}

log "Downloading $BASE/$FILE"
fetch "$BASE/$FILE" "$TMP/$FILE"
fetch "$BASE/checksums.txt" "$TMP/checksums.txt"
EXPECTED="$(awk -v f="$FILE" '{ n=$2; sub(/^\*/, "", n); if (n == f) print $1 }' "$TMP/checksums.txt")"
[ -n "$EXPECTED" ] || die "no checksum for $FILE in checksums.txt"
ACTUAL="$(sha256sum "$TMP/$FILE" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || die "SHA-256 mismatch for $FILE (expected $EXPECTED, got $ACTUAL)"
log "SHA-256 verified: $ACTUAL"

REINSTALL=0
if systemctl list-unit-files sem-agent.service >/dev/null 2>&1 && [ -f "$UNIT" ]; then
  REINSTALL=1
  systemctl stop sem-agent.service || true
fi
install -m 0755 -o root -g root "$TMP/$FILE" "$BIN"

ENROLL=(enroll --server "$SERVER" --token "$TOKEN")
[ "$INSECURE" = 1 ] && ENROLL+=(--insecure-skip-verify)
[ -n "$CA_FILE" ] && ENROLL+=(--ca-file "$CA_FILE")
if [ "$REINSTALL" = 1 ] || [ -f /etc/sem-agent/agent.json ]; then ENROLL+=(--force); fi
log "Enrolling"
"$BIN" "${ENROLL[@]}" </dev/null

log "Installing systemd unit $UNIT"
cat > "$UNIT" <<'EOF'
[Unit]
Description=SecureEndpoint Manager endpoint agent
After=network-online.target systemd-udevd.service
Wants=network-online.target
ConditionFileIsExecutable=/usr/local/bin/sem-agent

[Service]
Type=simple
ExecStart=/usr/local/bin/sem-agent run
Restart=always
RestartSec=10
TimeoutStopSec=30
KillMode=mixed
UMask=0077
PrivateTmp=yes
ProtectHome=read-only
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
LockPersonality=yes
RestrictRealtime=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallArchitectures=native
LimitNOFILE=16384
StateDirectory=sem-agent
StateDirectoryMode=0700
LogsDirectory=sem-agent
LogsDirectoryMode=0700
ConfigurationDirectory=sem-agent
ConfigurationDirectoryMode=0700

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$UNIT"
systemctl daemon-reload
systemctl enable --now sem-agent.service
sleep 2
systemctl --no-pager --lines=0 status sem-agent.service || true
"$BIN" status </dev/null || true
log "SecureEndpoint agent installed."
