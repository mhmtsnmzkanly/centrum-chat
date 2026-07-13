#!/usr/bin/env bash

set -euo pipefail

if (( EUID == 0 )); then
  systemctl start centrum-chat.service
else
  sudo systemctl start centrum-chat.service
fi

echo "CentrumChat started."
