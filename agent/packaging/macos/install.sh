#!/bin/bash
# SecureEndpoint agent installer for macOS (served as /downloads/install-macos.sh).
#
#   curl -fsSL https://SERVER/downloads/install-macos.sh | sudo bash -s -- --server https://SERVER --token sem_enr_xxx
#
# Picks sem-agent-darwin-arm64 (Apple Silicon) or sem-agent-darwin-amd64 (Intel),
# verifies SHA-256, installs to /usr/local/bin/sem-agent, enrolls and loads the
# launchd daemon com.secureendpoint.agent.
set -euo pipefail

SERVER=""
TOKEN=""
EXT_IDS=()
INSECURE=0
CA_FILE=""
BIN=/usr/local/bin/sem-agent
LABEL=com.secureendpoint.agent
PLIST=/Library/LaunchDaemons/$LABEL.plist

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --server=*) SERVER="${1#*=}"; shift ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    --insecure-skip-verify) INSECURE=1; shift ;;
    --extension-id) EXT_IDS+=(--extension-id "${2:-}"); shift 2 ;;
    --ca-file) CA_FILE="${2:-}"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$SERVER" ] || die "--server is required"
[ -n "$TOKEN" ] || die "--token is required"
case "$TOKEN" in sem_enr_*) ;; *) die "--token must be an enrollment token (sem_enr_...)";; esac
[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"

# Universal: detect Apple Silicon even when running under Rosetta.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH=arm64; else ARCH=amd64; fi
SERVER="${SERVER%/}"
BASE="$SERVER/downloads"
FILE="sem-agent-darwin-$ARCH"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CURL=(curl -fsSL --retry 3)
[ "$INSECURE" = 1 ] && CURL+=(-k)
[ -n "$CA_FILE" ] && CURL+=(--cacert "$CA_FILE")

log "Downloading $BASE/$FILE"
"${CURL[@]}" -o "$TMP/$FILE" "$BASE/$FILE"
"${CURL[@]}" -o "$TMP/checksums.txt" "$BASE/checksums.txt"
EXPECTED="$(awk -v f="$FILE" '{ n=$2; sub(/^\*/, "", n); if (n == f) print $1 }' "$TMP/checksums.txt")"
[ -n "$EXPECTED" ] || die "no checksum for $FILE in checksums.txt"
ACTUAL="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || die "SHA-256 mismatch for $FILE (expected $EXPECTED, got $ACTUAL)"
log "SHA-256 verified: $ACTUAL"

if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "system/$LABEL" 2>/dev/null || true
fi
mkdir -p /usr/local/bin /Library/Logs/SecureEndpoint
install -m 0755 -o root -g wheel "$TMP/$FILE" "$BIN"
xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true

ENROLL=(enroll --server "$SERVER" --token "$TOKEN")
[ "$INSECURE" = 1 ] && ENROLL+=(--insecure-skip-verify)
[ -n "$CA_FILE" ] && ENROLL+=(--ca-file "$CA_FILE")
if [ -f "/Library/Application Support/SecureEndpoint/agent.json" ]; then ENROLL+=(--force); fi
log "Enrolling"
"$BIN" "${ENROLL[@]}" </dev/null

log "Installing launchd daemon $PLIST"
cat > "$PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>com.secureendpoint.agent</string>
	<key>ProgramArguments</key><array><string>/usr/local/bin/sem-agent</string><string>run</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>ProcessType</key><string>Background</string>
	<key>Umask</key><integer>63</integer>
	<key>StandardOutPath</key><string>/Library/Logs/SecureEndpoint/launchd.out.log</string>
	<key>StandardErrorPath</key><string>/Library/Logs/SecureEndpoint/launchd.err.log</string>
</dict>
</plist>
EOF
chown root:wheel "$PLIST"
chmod 0644 "$PLIST"
launchctl bootstrap system "$PLIST"
launchctl enable "system/$LABEL" || true
sleep 2
# Per-user activity helper (starts at graphical logon) + browser native host.
"$BIN" integration install "${EXT_IDS[@]}" </dev/null || log "warning: activity helper not registered"
"$BIN" status </dev/null || true
log "SecureEndpoint agent installed."
echo "Note: grant Full Disk Access to /usr/local/bin/sem-agent via MDM (PPPC profile) for complete inventory."
