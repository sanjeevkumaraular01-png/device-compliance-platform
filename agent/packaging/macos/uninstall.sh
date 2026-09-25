#!/bin/bash
# Removes the SecureEndpoint agent from macOS.
#   sudo ./uninstall.sh [--purge]
set -euo pipefail
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
LABEL=com.secureendpoint.agent
launchctl bootout "system/$LABEL" 2>/dev/null || true
rm -f "/Library/LaunchDaemons/$LABEL.plist"
[ -x /usr/local/bin/sem-agent ] && /usr/local/bin/sem-agent reset-usb || true
[ -x /usr/local/bin/sem-agent ] && /usr/local/bin/sem-agent integration uninstall || true
# Stop the per-user activity helper in every GUI session
for uid in $(ps -axo uid=,command= | awk '/sem-agent user-helper/ {print $1}' | sort -u); do
  launchctl bootout "gui/$uid/com.secureendpoint.agent.user" 2>/dev/null || true
done
pkill -f "sem-agent user-helper" 2>/dev/null || true
rm -f /usr/local/bin/sem-agent
if [ "$PURGE" = 1 ]; then
  rm -rf "/Library/Application Support/SecureEndpoint" /Library/Logs/SecureEndpoint
  echo "configuration, keys, state and logs removed"
fi
echo "SecureEndpoint agent uninstalled. Retire the device in the console to revoke its credentials."
