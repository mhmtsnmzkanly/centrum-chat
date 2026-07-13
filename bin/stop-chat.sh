#!/usr/bin/env bash

set -euo pipefail

if (( EUID == 0 )); then
  systemctl stop centrum-chat.service
else
  sudo systemctl stop centrum-chat.service
fi

echo "CentrumChat stopped gracefully."
