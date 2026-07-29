#!/usr/bin/env bash
set -euo pipefail

backup_dir=${1:?usage: restore-chat.sh BACKUP_DIRECTORY TARGET_ROOT}
target_root=${2:?usage: restore-chat.sh BACKUP_DIRECTORY TARGET_ROOT}
[[ -f "$backup_dir/manifest.txt" && -f "$backup_dir/checksums.sha256" ]] || { echo "Invalid backup manifest." >&2; exit 1; }
[[ -f "$backup_dir/database.sqlite" && -d "$backup_dir/media" ]] || { echo "Backup is incomplete." >&2; exit 1; }
[[ ! -e "$target_root" ]] || { echo "Refusing to overwrite existing target: $target_root" >&2; exit 1; }
case "$backup_dir$target_root" in *"'"*) echo "Paths containing a single quote are unsupported." >&2; exit 1;; esac
(cd "$backup_dir" && sha256sum -c --strict checksums.sha256)
[[ $(sqlite3 "$backup_dir/database.sqlite" 'PRAGMA integrity_check;') == ok ]] || { echo "Backup integrity_check failed." >&2; exit 1; }
[[ -z $(sqlite3 "$backup_dir/database.sqlite" 'PRAGMA foreign_key_check;') ]] || { echo "Backup foreign_key_check failed." >&2; exit 1; }
tmp_root="${target_root}.partial.$$"
trap 'rm -rf "$tmp_root"' EXIT
mkdir -p "$tmp_root/database" "$tmp_root/storage"
cp -a "$backup_dir/database.sqlite" "$tmp_root/database/centrumchat.sqlite"
cp -a "$backup_dir/media/." "$tmp_root/storage/"
mv "$tmp_root" "$target_root"
trap - EXIT
migration=$(sqlite3 "$target_root/database/centrumchat.sqlite" 'SELECT COALESCE(MAX(version), 0) FROM schema_migrations;')
printf 'Restore complete: %s (migration %s)\n' "$target_root" "$migration"
