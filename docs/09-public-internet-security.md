# CentrumChat Server — Public Internet Security

This document records the security controls that are actually implemented in the current server
build. It is intentionally operational: if a behavior is described here as present, it should be
verifiable in code and tests.

## Transport and browser policy

- CORS is deny-by-default. Same-origin requests are always allowed; additional browser origins must
  be listed explicitly in `ALLOWED_ORIGINS`.
- WebSocket upgrades validate the browser `Origin` header before a socket exists.
- Client IPs for IP-scoped limits and logging come from a central trusted-proxy policy
  (`src/shared/security/clientIp.ts`): by default the real socket peer is used and no forwarded
  header is trusted. When the direct peer is listed in `TRUSTED_PROXY_IPS` (exact IPs or CIDR
  blocks), `X-Forwarded-For` is resolved right-to-left — entries added by trusted proxies are
  skipped and the nearest untrusted entry is the client. Malformed or empty chain entries, and
  chains consisting solely of trusted proxies, fall back to the socket IP. `CF-Connecting-IP`,
  `X-Real-IP`, `Forwarded`, `Host`, and `Origin` are never used as an IP authority; IPv4-mapped
  IPv6 peers are normalized and IPv6 output is canonicalized so one client cannot occupy several
  rate-limit buckets through alternative spellings.
- Baseline HTTP security headers are applied centrally to all non-101 responses, and HTML responses
  receive a fixed CSP tuned to the shipped frontend.
- `Strict-Transport-Security: max-age=15552000; includeSubDomains` is emitted only when
  `APP_ENV=production` and `PUBLIC_HTTPS=true`. This flag means the operator asserts that the
  public endpoint is HTTPS. Forwarded headers cannot enable HSTS.
- HSTS `preload` is intentionally not emitted automatically; preload enrollment is an operational
  decision that needs separate review.

## WebSocket DoS controls

- Inbound abuse controls:
  - maximum inbound text payload size: `MAX_WS_MESSAGE_BYTES`
  - malformed/oversized protocol violation threshold: `WS_PROTOCOL_ERROR_LIMIT`
  - inbound per-connection token-bucket limiter:
    `WS_INBOUND_RATE_LIMIT_MAX_TOKENS` / `WS_INBOUND_RATE_LIMIT_REFILL_INTERVAL_MS`
- Connection admission controls:
  - concurrent per-user cap: `WS_MAX_CONNECTIONS_PER_USER` (default `5`)
  - concurrent per-IP cap: `WS_MAX_CONNECTIONS_PER_IP` (default `25`)
  - admission is owned by one connection-registry operation so the limit check and registration stay
    internally consistent
- Outbound backpressure controls:
  - every production WebSocket write passes through one `ConnectionManager` send boundary
  - before sending application payloads, the boundary checks `socket.bufferedAmount`
  - if buffered bytes exceed `WS_MAX_BUFFERED_AMOUNT_BYTES` (default `1048576`, 1 MiB), the server
    closes the slow client instead of queueing more data
  - fanout isolates per-connection send failures so one slow or broken client does not abort
    delivery to healthy clients
- Heartbeat and stale-connection controls:
  - heartbeat is application-level, not protocol ping/pong
  - the server sends `system.ping` every `WS_HEARTBEAT_INTERVAL_MS` on idle connections
  - the frontend answers automatically with `system.pong`
  - valid inbound envelopes refresh connection activity; malformed payloads do not
  - a connection with no valid inbound activity for `WS_IDLE_TIMEOUT_MS` is closed and cleaned up
  - one shared lifecycle job owns this sweep; there is no timer per connection

## Authentication and secrets

- Passwords are hashed with PBKDF2 before persistence.
- Refresh tokens are stored hashed, carry a stable session identifier (`sid`) in access tokens, and
  rotate atomically without extending remembered-session absolute expiry indefinitely.
- Verification, password-reset, and email-change tokens are stored hashed in dedicated tables and
  consumed with compare-and-swap-style single-use updates.
- Verification/reset/email-change links are built only from trusted `PUBLIC_BASE_URL`; `Host`,
  `Origin`, `X-Forwarded-Host`, and `X-Forwarded-Proto` cannot affect link generation.
- Production mail delivery is explicit (`MAIL_ADAPTER=resend` today); production rejects the
  development adapter at startup.
- Attachment uploads record `uploader_id`; unattached uploads can only be fetched or attached by
  their uploader.
- Log redaction is centralized in the logger boundary. Known credential/secret field names are
  redacted before log serialization, with bounded recursion and truncation to avoid logging
  attacker-controlled deep or enormous structures.
- The shipped frontend keeps bearer tokens in browser-readable storage: `sessionStorage` when
  `rememberMe=false`, `localStorage` when `rememberMe=true`. This remains an XSS risk surface; CSP
  reduces but does not eliminate that risk.

## Account-state policy

- Unverified accounts may authenticate, refresh, logout, list/revoke their own sessions, resend
  verification, complete verification, change password, request password reset, complete password
  reset, and complete an in-progress authenticated email change.
- Unverified accounts may not send messages, open DMs, create groups, add/remove group members,
  upload attachments/avatars/covers, react, or perform global user search.
- Enforcement is server-side and centralized through `AccountPolicy.requireVerifiedEmail(userId)`;
  the frontend banner/disabled controls are UX only.
- Password reset and password change invalidate active pending email-change tokens. Password changes
  compare-and-swap the password hash after asynchronous verification so a concurrent reset or change
  cannot be overwritten by a stale request.

## Health and readiness

- `GET /health/live` is a cheap liveness probe and does not query SQLite.
- `GET /health/ready` performs the SQLite readiness check.
- `GET /health` remains a compatibility alias for readiness.
- Readiness failures return a generic non-2xx response; internal details stay in server logs.

## Graceful shutdown

Shutdown order is explicit:

1. stop lifecycle jobs from scheduling more work
2. stop the shared WebSocket heartbeat/stale-connection job
3. close active sockets and clean the connection registry
4. stop the existing session-cleanup job
5. shut down the HTTP server
6. close the SQLite database

Repeated shutdown calls are expected to be safe.
## Abuse and moderation controls

Registration, login, and password-reset request retain rate limits and pass through the configured
CAPTCHA verifier using the actual peer IP. Blocks and sanctions are checked server-side at mutation
boundaries. Moderator authority is reloaded from SQLite for every operator request. Sensitive context
views and moderation mutations append bounded/redacted audit events. See
`10-moderation-and-user-safety.md`.

## Administration security boundary

Four persisted roles map through one immutable permission registry. Privileged routes ignore client
role claims and reload authority from SQLite. Role changes use expected-role compare-and-swap,
ownership transfer is transactional, and the final owner cannot be removed. Mutable database settings
are fixed, typed, bounded, versioned, and exclude secrets. Administration mutations append
bounded/redacted audit events.
