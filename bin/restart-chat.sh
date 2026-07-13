#!/usr/bin/env bash

set -euo pipefail

if (( EUID == 0 )); then
  systemctl restart centrum-chat.service
else
  sudo systemctl restart centrum-chat.service
fi

echo "CentrumChat restarted."
