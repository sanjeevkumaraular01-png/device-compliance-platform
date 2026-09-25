#!/bin/sh
set -e
systemctl disable --now sem-agent.service >/dev/null 2>&1 || true
/usr/local/bin/sem-agent reset-usb >/dev/null 2>&1 || true
