#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${CENTRUM_CHAT_DIR:-/opt/centrum-chat}"

if (( EUID != 0 )); then
  exec sudo "$0" "$@"
fi

cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "Error: $APP_DIR is not a Git checkout." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: Git working tree is not clean; update cancelled." >&2
  git status --short >&2
  exit 1
fi

before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"

/usr/local/bin/restart-chat

ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8047/health/ready >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if (( ready == 0 )); then
  echo "Error: CentrumChat did not become ready after the update." >&2
  systemctl --no-pager --full status centrum-chat.service >&2 || true
  exit 1
fi

echo "CentrumChat update complete: $before -> $after"
