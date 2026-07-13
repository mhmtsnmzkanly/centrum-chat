# CentrumChat

A realtime chat server: Deno 2.x + TypeScript + SQLite, no ORM, no external web framework, native
WebSocket. Channels, groups, DMs, reactions, typing indicators, attachments, notifications, and
search, behind a strictly layered architecture (Transport → Protocol → Application → Domain →
Storage → SQLite).

See `docs/` for the full design: `01-architecture.md` (layering, protocol abstraction,
presence/permissions model), `02-database-schema.md`, `03-websocket-events.md` (the full WS event
catalog), `04-http-api.md` (the narrow HTTP surface), `05-folder-structure.md`,
`06-implementation-plan.md` (the phased build order this project followed),
`09-public-internet-security.md` (the current public-internet security controls), and
`12-control-center-api-contract.md` (the authoritative administration backend contract).

## Requirements

- [Deno](https://deno.com/) 2.x (built against 2.6). No other runtime dependency — SQLite access
  goes through Deno's built-in `node:sqlite`.

## Quick start

```sh
cp .env.example .env
# edit .env: at minimum, set a real JWT_SECRET (see .env.example for how)

deno run --watch --env-file=.env --allow-net --allow-env --allow-read --allow-write src/main.ts
```

(`deno task dev`/`start` run the same entry point without `--env-file`, so use those only if you're
exporting the variables into your shell some other way — see below.)

On first run, `src/main.ts` opens (creating, if needed) the SQLite file at `DATABASE_PATH` and
applies every pending migration under `db/migrations/` in order — there's no separate "migrate"
command to run first. Each migration is tracked in a `schema_migrations` table so re-running the
server is always safe; add new schema changes as a new `db/migrations/NNNN_description.sql` file,
never by editing an already- applied one.

The server listens for both HTTP and the `GET /ws` WebSocket upgrade on the same `HOST:PORT`.

For a fresh deployment, register the intended owner account, stop the server, set
`BOOTSTRAP_OWNER_EMAIL` to that existing normalized address, and restart once. The startup CAS
promotes it only when no owner exists; remove the variable after the successful bootstrap. Upgrades
from migration 0008 preserve administrative continuity by promoting the oldest existing admin when
no owner exists.

## Environment variables

All loaded by `src/shared/config/config.ts`; see `.env.example` for the authoritative list with
defaults. `deno task dev`/`start` do **not** read `.env` automatically — Deno only does that with an
explicit `--env-file` flag, which isn't in `deno.json`'s task definitions. Either export the
variables into your shell yourself, or run the server directly with
`deno run --env-file=.env --allow-net --allow-env --allow-read --allow-write src/main.ts`.

| Variable                                   | Required | Default                                 | Notes                                                                                                  |
| ------------------------------------------ | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `APP_ENV`                                  | no       | `development`                           | `development` \| `test` \| `production`; production enables stricter validation                        |
| `HOST`                                     | no       | `0.0.0.0`                               | HTTP + WS bind address                                                                                 |
| `PORT`                                     | no       | `8080`                                  |                                                                                                        |
| `DATABASE_PATH`                            | no       | `./storage/database/centrumchat.sqlite` | Parent directory is created automatically                                                              |
| `MEDIA_ROOT`                               | no       | `./storage`                             | Upload root; files land under `profile/` (avatars), `cover/`, and `attachments/` subfolders            |
| `ALLOWED_ORIGINS`                          | no       | empty                                   | Comma-separated extra browser origins allowed for CORS/WS Origin checks; same-origin is always allowed |
| `TRUSTED_PROXY_IPS`                        | no       | empty                                   | Comma-separated proxy IPs/CIDRs whose `X-Forwarded-For` is honored; empty = socket peer is the client  |
| `JWT_SECRET`                               | **yes**  | —                                       | HS256 signing key for access tokens. Generate with `openssl rand -hex 32`                              |
| `PUBLIC_BASE_URL`                          | no       | `http://localhost:8080`                 | Used for verification/reset/email-change links; must be explicit HTTPS in production                   |
| `ACCESS_TOKEN_TTL_SECONDS`                 | no       | `900` (15 min)                          | Access tokens stay short-lived even when remember-me is enabled                                        |
| `SESSION_DEFAULT_TTL_MS`                   | no       | `86400000` (24h)                        | Refresh-session lifetime when `rememberMe=false`                                                       |
| `SESSION_REMEMBERED_TTL_MS`                | no       | `2592000000` (30d)                      | Refresh-session lifetime when `rememberMe=true`; absolute expiry is preserved across rotation          |
| `EMAIL_VERIFICATION_TTL_MS`                | no       | `3600000` (1h)                          | One-time email-verification token lifetime                                                             |
| `PASSWORD_RESET_TTL_MS`                    | no       | `1800000` (30 min)                      | One-time password-reset token lifetime                                                                 |
| `EMAIL_CHANGE_TTL_MS`                      | no       | `3600000` (1h)                          | One-time email-change token lifetime                                                                   |
| `MAIL_ADAPTER`                             | no       | `development`                           | `development` \| `resend`; production rejects `development`                                            |
| `MAIL_FROM_ADDRESS`                        | no       | `noreply@example.invalid`               | Sender used by the production mail adapter                                                             |
| `MAIL_FROM_NAME`                           | no       | `CentrumChat`                           | Display name used by the production mail adapter                                                       |
| `RESEND_API_KEY`                           | no       | empty                                   | Required when `MAIL_ADAPTER=resend`                                                                    |
| `CAPTCHA_ADAPTER`                          | no       | `development`                           | `development` \| `turnstile`; production rejects `development`                                         |
| `CAPTCHA_SITE_KEY`                         | no       | empty                                   | Public Turnstile site key exposed through `/api/config/public`                                         |
| `CAPTCHA_SECRET_KEY`                       | no       | empty                                   | Server-only Turnstile secret; required for the production adapter                                      |
| `CAPTCHA_EXPECTED_HOSTNAME`                | no       | `localhost`                             | Exact hostname required in successful Turnstile verification results                                   |
| `BOOTSTRAP_OWNER_EMAIL`                    | no       | empty                                   | On restart, promotes one matching existing account only when no owner exists                           |
| `LOG_LEVEL`                                | no       | `info`                                  | `debug` \| `info` \| `warn` \| `error`                                                                 |
| `MAX_ATTACHMENT_SIZE_BYTES`                | no       | `26214400` (25MB)                       | `POST /api/media/upload` limit                                                                         |
| `MAX_AVATAR_SIZE_BYTES`                    | no       | `5242880` (5MB)                         | `POST /api/media/avatar` limit                                                                         |
| `MAX_COVER_SIZE_BYTES`                     | no       | `5242880` (5MB)                         | `POST /api/media/cover` limit                                                                          |
| `MAX_WS_MESSAGE_BYTES`                     | no       | `65536`                                 | Transport-level inbound WS payload cap                                                                 |
| `WS_PROTOCOL_ERROR_LIMIT`                  | no       | `3`                                     | Socket closes after this many protocol violations                                                      |
| `WS_INBOUND_RATE_LIMIT_MAX_TOKENS`         | no       | `120`                                   | Transport-level inbound WS message budget per connection                                               |
| `WS_INBOUND_RATE_LIMIT_REFILL_INTERVAL_MS` | no       | `10000`                                 | Refill window for the inbound WS rate limiter                                                          |
| `WS_MAX_CONNECTIONS_PER_USER`              | no       | `5`                                     | Concurrent authenticated WebSocket connections allowed per user                                        |
| `WS_MAX_CONNECTIONS_PER_IP`                | no       | `25`                                    | Concurrent authenticated WebSocket connections allowed per peer IP                                     |
| `WS_MAX_BUFFERED_AMOUNT_BYTES`             | no       | `1048576` (1 MiB)                       | Outbound WebSocket buffered-byte threshold before a slow client is closed                              |
| `WS_HEARTBEAT_INTERVAL_MS`                 | no       | `30000`                                 | Application-level WebSocket heartbeat cadence                                                          |
| `WS_IDLE_TIMEOUT_MS`                       | no       | `90000`                                 | WebSocket idle timeout; must be greater than the heartbeat interval                                    |
| `PUBLIC_HTTPS`                             | no       | `false`                                 | Production assertion that the public deployment is HTTPS; required before HSTS is emitted              |
| `SESSION_CLEANUP_INTERVAL_MS`              | no       | `21600000` (6h)                         | Periodic user-session cleanup interval                                                                 |
| `REVOKED_SESSION_RETENTION_MS`             | no       | `2592000000` (30d)                      | How long revoked sessions are retained before cleanup                                                  |

The server fails fast at boot (before binding a port) if `JWT_SECRET` is missing, if any
numeric/enum/origin variable is malformed, or if `APP_ENV=production` is paired with a placeholder
JWT secret.

On startup, the server runs one user-session cleanup pass after migrations finish, then schedules
periodic cleanup on `SESSION_CLEANUP_INTERVAL_MS`. Cleanup failures are logged and do not stop the
process; the timer is stopped during graceful shutdown.

Transport hardening in the current build:

- deny-by-default CORS and explicit browser `Origin` validation for WebSocket upgrades
- trusted-proxy client-IP resolution: `X-Forwarded-For` is honored only when the direct socket peer
  is listed in `TRUSTED_PROXY_IPS` (right-to-left chain walk, IPv4/IPv6, fail-safe to the socket
  IP); spoofed forwarded headers from untrusted peers are ignored
- baseline security headers on every HTTP response, plus a CSP on HTML responses
- HSTS emitted only in production when `PUBLIC_HTTPS=true`; forwarded headers never affect that
  decision
- transport-level WebSocket size/protocol/rate-abuse guards
- per-user and per-IP WebSocket connection caps enforced before the upgrade completes
- one central outbound WebSocket send boundary that closes slow clients once `bufferedAmount`
  exceeds the configured byte limit
- one shared WebSocket lifecycle job that sends application-level `system.ping` pushes, expects
  `system.pong` requests back, and closes stale sockets
- centralized structured-log redaction for common credentials/secrets before JSON log lines hit
  stdout/stderr
- upload ownership persisted in the database, so unattached files can only be fetched or attached by
  their uploader
- ordinary attachments served with download-oriented headers; avatar/cover uploads must pass real
  image-signature validation
- `/health/live` is a cheap process liveness probe; `/health/ready` (and compatibility `/health`)
  perform the SQLite readiness check

Account-security behavior in the current build:

- access tokens carry both `sub` (user id) and `sid` (trusted current session id)
- refresh sessions are listed and revoked through authenticated HTTP routes; revocation is
  ownership-scoped and does not expose token hashes
- `rememberMe=false` is intended for browser `sessionStorage`; `rememberMe=true` is intended for
  browser `localStorage`
- unverified accounts may authenticate and manage their own account security state, but cannot send
  messages, open DMs, create groups, add members, upload media, react, or use global user search
- registration issues a verification session plus a verification mail; password reset and email
  change use separate hashed one-time tokens built from `PUBLIC_BASE_URL`
- browser-readable token storage remains an XSS risk surface; the shipped CSP reduces but does not
  eliminate that risk

## Running tests

```sh
deno task test     # unit + integration + protocol + repository suites
deno task check     # type-check
deno task lint       # deno lint
deno task fmt        # deno fmt
```

Tests are organized under `tests/` by kind (see `docs/05-folder-structure.md`):

- `tests/unit/` — domain services exercised against in-memory fake repositories (fast, no I/O).
- `tests/integration/` — full server boot (`startHttpServer` + real WS clients) against a temporary
  SQLite file per test.
- `tests/protocol/` — `JsonCodec` and envelope-shape validation.
- `tests/repository/` — each `Sqlite*Repository` against a temporary SQLite file.

Integration tests boot a real `Deno.serve` instance on an ephemeral port (`port: 0`) and a real
SQLite file under a temp directory; both are torn down in each test's `finally` block. There's no
shared test database or server across test files.

## Project layout

```
src/
├── main.ts            composition root: config → db → repos → services → handlers → transport
├── transport/          Deno.serve + WebSocket upgrade/read-loop — no business logic
├── protocol/            ProtocolCodec (JsonCodec today; the seam EnfCodec would fill in v2)
├── application/        one WS handler per event, one route per HTTP endpoint
├── domain/               pure business logic; only depends on repository *ports*
├── storage/              SQLite repositories — all SQL lives here
└── shared/               errors, logging, validation, rate limiting, config
```

Full rationale for this split, and the dependency rule between layers, is in
`docs/01-architecture.md`. `docs/05-folder-structure.md` has the complete file tree.

## What's deliberately out of scope

Called out explicitly in `docs/06-implementation-plan.md` so they read as decisions, not gaps:

- Horizontal scaling / multi-process pub-sub for the in-memory Connection Manager.
- An actual binary `EnfCodec` (only the `ProtocolCodec` seam for one exists).
- Wiring the reference frontend at a sibling `chat/` project — this is a server-only build with no
  bridge script.
- A real payment/verification flow behind `isPremium` (stays a plain boolean).
- Durable/cron-based orphaned-attachment cleanup (a `setInterval` in `main.ts` is enough for a
  reference implementation; it doesn't survive a restart mid-window).

# User safety and moderation

The backend provides directional blocks, access-checked abuse reports, persisted moderator/admin
authority, report workflow operations, sanctions, an append-oriented security audit ledger, and
CAPTCHA-protected registration/login/recovery. See `docs/10-moderation-and-user-safety.md` and
`docs/11-moderation-api-contract.md`. The integrated Control Center is served at `/control-center`;
it derives presentation capabilities from `GET /api/control-center/me`, while the backend
independently authorizes every operation. This checkout contains no `web/admin/` client; the
existing `/admin` not-found behavior is unchanged.
