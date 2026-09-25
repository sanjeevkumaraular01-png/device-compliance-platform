#!/bin/sh
set -e
systemctl daemon-reload >/dev/null 2>&1 || true
if [ -f /etc/sem-agent/agent.json ]; then
  systemctl enable sem-agent.service >/dev/null 2>&1 || true
  systemctl restart sem-agent.service >/dev/null 2>&1 || true
else
  echo "sem-agent installed. Enroll with:"
  echo "  sudo sem-agent enroll --server https://SERVER --token sem_enr_xxx && sudo systemctl enable --now sem-agent"
fi
