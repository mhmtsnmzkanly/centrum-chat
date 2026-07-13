#!/usr/bin/env bash

set -euo pipefail

if (( EUID == 0 )); then
  systemctl --no-pager --full status centrum-chat.service
else
  sudo systemctl --no-pager --full status centrum-chat.service
fi
