# Production operations runbook

## Prerequisites

Run one Deno 2 process through `deploy/centrum-chat.service`; persist both `DATABASE_PATH` and
`MEDIA_ROOT` outside transient deployment directories. Configure production `APP_ENV`, strong
`JWT_SECRET`, HTTPS `PUBLIC_BASE_URL`, explicit `ALLOWED_ORIGINS`, `MAIL_ADAPTER=resend`, and
`CAPTCHA_ADAPTER=turnstile`. Keep secrets only in the systemd `EnvironmentFile`, never in backups.
Set `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY`, `CAPTCHA_EXPECTED_HOSTNAMES`, and
`CAPTCHA_VERIFY_TIMEOUT_MS`; staging and production must use separate Turnstile widgets/keys.

Before every deploy, take a backup, run `deno task check`, `deno task lint`, `deno task test`, then
restart with `systemctl restart centrum-chat.service` and check `GET /health/ready`.

## Backup and restore

`bin/backup-chat.sh BACKUP_DIRECTORY` uses SQLite's `.backup` online-backup API, not `cp`; this
captures committed WAL content. It copies the whole media root, writes `manifest.txt` (timestamp,
commit, migration level) and then `checksums.sha256` for `database.sqlite`, `manifest.txt`, and every
media file (never the checksum file itself). Set `DATABASE_PATH` and `MEDIA_ROOT` explicitly.

The scripts require `bash`, `sqlite3`, GNU/coreutils `sha256sum`, `find`, `sort`, `xargs`, `mkdir`,
`cp`, `mv`, `rm`, `date`, `git`, and `mktemp`. Verify a backup with `sha256sum -c checksums.sha256`, `PRAGMA integrity_check`, and
`PRAGMA foreign_key_check` (the restore script performs all three). Restore only into a new empty
directory: `bin/restore-chat.sh BACKUP_DIRECTORY TARGET_ROOT`. It refuses an existing target and
creates `TARGET_ROOT/database/centrumchat.sqlite` plus `TARGET_ROOT/storage/`; point a stopped,
isolated instance at those paths before promoting it. Roll back by stopping the service, preserving
the failed paths, restoring into a fresh target, updating the service environment, and checking
`/health/ready` before reopening traffic.

Run `deno task backup:smoke` after changing backup tooling. It creates only temporary fixture data.

## Proxy and provider contract

Terminate HTTPS at the proxy and forward WebSocket Upgrade/Connection headers. Set upload body
limits at least as high as the application limits, use read/write timeouts above the 90-second WS
idle timeout, and pass only validated client IP data through `X-Forwarded-For` from peers listed in
`TRUSTED_PROXY_IPS`. Do not log query strings: WS and protected media token fallbacks use `?token=`.
Analytics/error tracking must redact query parameters; the application sends `no-referrer` headers.

Keep CORS origins explicit. Preserve application security headers and cache only public avatar/cover
media; ordinary attachments are authenticated and `no-store`. Probe `/health/live` for liveness and
`/health/ready` for SQLite readiness.

For staging, verify Turnstile widget creation, allowlisted hostname, registration and password-reset
success, invalid/expired/replayed token, wrong action/hostname, timeout/provider-unavailable, rate
limit interaction, public-config site-key-only output, and log redaction. Use staging keys only;
Cloudflare response tokens, secret keys, request bodies, and query strings must not appear in proxy,
analytics, APM, error-tracking, or application logs. This repository does not perform live provider
calls by default, and Turnstile outages leave health/readiness up while protected auth endpoints
return `CAPTCHA_UNAVAILABLE`.

## Incident response and secret rotation

Inspect systemd journal output (`journalctl -u centrum-chat.service`) and application JSON logs.
For database/media incidents, stop writes first, preserve evidence, restore into a separate target,
verify checksums and readiness, then promote. Rotate `JWT_SECRET`, Resend and Turnstile secrets in
the environment file, restart, and verify login/recovery behavior; JWT rotation intentionally
invalidates existing access tokens.
