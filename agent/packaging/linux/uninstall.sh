#!/usr/bin/env bash
# Removes the SecureEndpoint agent from Linux.
#   sudo ./uninstall.sh           # keep /etc/sem-agent, /var/lib/sem-agent, /var/log/sem-agent
#   sudo ./uninstall.sh --purge   # remove configuration, keys, state and logs too
set -euo pipefail
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }

BIN=/usr/local/bin/sem-agent
systemctl disable --now sem-agent.service 2>/dev/null || true
# Remove USB restrictions (udev rules, deauthorised interfaces).
[ -x "$BIN" ] && "$BIN" reset-usb || true
rm -f /etc/udev/rules.d/99-sem-usb.rules
command -v udevadm >/dev/null 2>&1 && udevadm control --reload-rules || true
rm -f /etc/systemd/system/sem-agent.service /lib/systemd/system/sem-agent.service
systemctl daemon-reload || true
rm -f "$BIN"
if [ "$PURGE" = 1 ]; then
  rm -rf /etc/sem-agent /var/lib/sem-agent /var/log/sem-agent
  # Policy files written by the agent (screen lock); keep apt/dnf auto-update config.
  rm -f /etc/dconf/db/local.d/00-sem-screenlock /etc/dconf/db/local.d/locks/00-sem-screenlock
  command -v dconf >/dev/null 2>&1 && dconf update || true
  echo "configuration, keys, state and logs removed"
fi
echo "SecureEndpoint agent uninstalled. Retire the device in the console to revoke its credentials."
