#!/usr/bin/env bash
set -euo pipefail

backup_dir=${1:?usage: backup-chat.sh BACKUP_DIRECTORY}
database_path=${DATABASE_PATH:-./storage/database/centrumchat.sqlite}
media_root=${MEDIA_ROOT:-./storage}
[[ -f "$database_path" ]] || { echo "Database not found: $database_path" >&2; exit 1; }
[[ -d "$media_root" ]] || { echo "Media root not found: $media_root" >&2; exit 1; }
[[ ! -e "$backup_dir" ]] || { echo "Refusing to overwrite existing backup: $backup_dir" >&2; exit 1; }
case "$backup_dir$database_path" in *"'"*) echo "Paths containing a single quote are unsupported." >&2; exit 1;; esac

tmp_dir="${backup_dir}.partial.$$"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/media"
# SQLite's online backup API includes committed WAL content; copying only the main
# database file would not provide this consistency guarantee in WAL mode.
sqlite3 "$database_path" ".backup '$tmp_dir/database.sqlite'"
cp -a "$media_root/." "$tmp_dir/media/"
commit=$(git rev-parse HEAD 2>/dev/null || printf 'unknown')
migration=$(sqlite3 "$tmp_dir/database.sqlite" 'SELECT COALESCE(MAX(version), 0) FROM schema_migrations;')
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'format_version=1\ncreated_at=%s\ngit_commit=%s\nmigration_version=%s\ndatabase_file=database.sqlite\nmedia_root=media\nchecksum_file=checksums.sha256\n' "$created" "$commit" "$migration" > "$tmp_dir/manifest.txt"
# Hash the payload after its manifest exists. The explicit roots avoid including
# checksums.sha256 itself while preserving arbitrary media names during traversal.
# sha256sum's standard escaped output remains compatible with sha256sum -c.
(cd "$tmp_dir" && find database.sqlite manifest.txt media -type f -print0 | sort -z | xargs -0 sha256sum) > "$tmp_dir/checksums.sha256"
mv "$tmp_dir" "$backup_dir"
trap - EXIT
printf 'Backup created: %s (migration %s)\n' "$backup_dir" "$migration"
