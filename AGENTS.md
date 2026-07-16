# CentrumChat Agent Guide

Operating manual for coding agents working in this repository. Read this before starting any task;
it replaces re-discovering the architecture from scratch.

## 1. Purpose and authority

This document consolidates the stable rules of the repository. When any source disagrees, use this
precedence order:

1. Production code (`src/**`, `web/**`)
2. Migrations and schema initialization (`db/migrations/**`, `src/storage/db.ts`)
3. Tests that execute production behavior (`tests/**`)
4. Current API-contract documents (`docs/03`, `docs/04`, `docs/11`, `docs/12`)
5. Architecture/implementation docs (`docs/01`, `docs/02`, `docs/05`, `docs/06`, `docs/09`,
   `docs/10`)
6. `README.md`
7. Historical review documents (`docs/07`, `docs/08`)
8. Code comments and previous-agent notes

Naming note: the product is **CentrumChat** everywhere in code, docs, and config
(`MAIL_FROM_NAME=CentrumChat`, `storage/database/centrumchat.sqlite`). If a task prompt uses another
project name, the repository name wins.

## 2. Project overview

A realtime chat **server plus static browser clients**: public channels, private groups, one-to-one
DMs, reactions, typing indicators, read tracking, attachments/avatars/covers, notifications, search,
presence — with full account security (verification, reset, email change, sessions), user safety
(blocks, reports, sanctions), and a four-role administration surface (Control Center).

- Backend: Deno 2.x + TypeScript, no ORM, no web framework, native `Deno.serve` + native WebSocket.
- Storage: SQLite via Deno's built-in `node:sqlite` (`DatabaseSync`), WAL mode, foreign keys ON.
- Frontends: plain HTML/CSS/JS in `web/`: `auth.html` is the shared auth/onboarding UI, `index.html`
  is the protected chat UI, and `control-center.html` is the protected operator UI. There is **no
  `web/admin/` directory in this checkout**; `/admin` is intentionally a 404.

Deliberately out of scope (decisions, not gaps — see `README.md` and
`docs/06-implementation-plan.md`): horizontal scaling / multi-process pub-sub, a binary `EnfCodec`
(only the `ProtocolCodec` seam exists), a real payment flow behind `isPremium`, durable/cron-based
orphan-attachment cleanup.

## 3. Technology stack and commands

From `deno.json` (the only task definitions — do not invent others):

| Task  | Command                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| dev   | `deno run --watch --allow-net --allow-env --allow-read --allow-write src/main.ts`                                 |
| start | `deno run --allow-net --allow-env --allow-read --allow-write src/main.ts`                                         |
| test  | `deno test --allow-net --allow-env --allow-read --allow-write` (scoped to `tests/` by `deno.json` `test.include`) |
| check | `deno check src/main.ts`                                                                                          |
| lint  | `deno lint`                                                                                                       |
| fmt   | `deno fmt` (check-only: `deno fmt --check`)                                                                       |

Important facts:

- **`.env` is not auto-loaded.** `deno task dev`/`start` need exported env vars, or run directly
  with `deno run --env-file=.env ...`. `JWT_SECRET` is the only hard-required variable; boot fails
  fast on any malformed value (`src/shared/config/config.ts`), and `APP_ENV=production` enforces
  much stricter validation (HTTPS `PUBLIC_BASE_URL`, non-placeholder secret, no `development` mail
  or CAPTCHA adapter, no `*` origin).
- Compiler options are `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — new code
  must type-check under all three.
- `deno fmt`/`deno lint` **exclude `docs/`, `media/`, and `web/`**. Frontend JS is not formatted or
  linted by the toolchain; match its existing style manually.
- Frontend verification is manual. Do not create automated frontend test files anywhere in the
  repository; `tests/` is reserved for backend, protocol, repository, and transport behavior.
- The only external dependency is `jsr:@std/assert` in backend tests. Production `src/**` has zero
  third-party dependencies. Do not add any without explicit architectural approval.

## 4. Repository map

```
src/main.ts                      composition root: config → db → repositories → services → handlers → transport
src/transport/http/              Deno.serve wrapper (httpServer.ts) + WS upgrade (wsUpgrade.ts); no business logic
src/transport/websocket/         connection.ts (read loop), connectionManager.ts (authoritative connection registry)
src/protocol/                    ProtocolCodec seam, JsonCodec, envelope types (envelopes.ts)
src/application/http/            RouteRegistry, one RouteHandler class per endpoint under routes/**
src/application/websocket/       WebSocketHandlerRegistry, one EventHandler per event under handlers/**,
                                 conversationFanout.ts (audience computation)
src/application/lifecycle/       sessionCleanupJob.ts, webSocketLifecycleJob.ts (heartbeat/stale sweep)
src/application/mail|captcha/    development + production (Resend / Turnstile) adapters
src/domain/                      pure business logic; depends only on repository *ports* (*.port.ts)
src/storage/db.ts                openDatabase (migration runner), withTransaction, SqliteTransactionManager
src/storage/repositories/        Sqlite*Repository — ALL SQL lives here
src/shared/                      config, errors, logging, validation, rate limiting, security headers/origin, id
db/migrations/                   NNNN_description.sql, applied in order at boot
web/auth.html + scripts/auth*.js shared authentication/recovery/onboarding state machine
web/index.html + scripts/chat*.js protected main chat UI
web/control-center.html + scripts/control-center*.js protected operator UI, served at /control-center
web/scripts/shared-auth.js       authoritative browser token/refresh/auth-fetch/returnTo/guard logic
tests/unit|integration|protocol|repository/   see §19
tests/support/                   fakes, testDatabase.ts, legacyDatabase.ts, wsTestClient.ts
docs/                            design + contracts; see §16 and §24
storage/                         runtime data (git-ignored): database/ (SQLite) + uploads profile/, cover/, attachments/ — never reset or edit for tests
```

Dependency direction: `transport → application → domain → (ports) ← storage`. Domain never imports
transport, application, or storage; storage implements domain ports; `src/main.ts` is the only place
that wires concrete implementations together (constructor injection everywhere).

## 5. Canonical terminology

Canonical names come from production code. The application-level canonical term for a chat container
is **conversation** with `conversationId` fields; migration `0004_conversation_terminology.sql`
renamed the original tables.

| Concept                 | Canonical (DB / code)                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| User                    | `users`, `User` entity (`src/domain/users/user.entity.ts`)                                          |
| Persisted login session | `user_sessions` table; the **refresh token is the credential**, stored only as `refresh_token_hash` |
| Conversation            | `conversations` table, `type IN ('channel','group','dm')`                                           |
| Membership              | `conversation_memberships` (rows only for group/dm; channels are public)                            |
| Read state              | `conversation_reads`                                                                                |
| Canonical DM pair       | `direct_conversation_pairs` (`user_low_id < user_high_id`, UNIQUE)                                  |
| Message / reaction      | `messages`, `reactions`                                                                             |
| Attachment              | `attachments` with `kind IN ('attachment','avatar','cover')` + `uploader_id`                        |
| Notification            | `notifications`                                                                                     |
| Block                   | `user_blocks` (directional row: blocker → blocked)                                                  |
| Report                  | `reports` (targets: `user`, `message`, `attachment`)                                                |
| Sanction                | `user_sanctions` (`message_mute`, `interaction_restriction`, `account_suspension`)                  |
| Audit event             | `security_audit_events`                                                                             |
| System settings         | `system_settings` (allow-listed keys, versioned)                                                    |
| System role             | `users.system_role IN ('user','moderator','admin','owner')` — authoritative role source             |

Legacy/compatibility names future agents WILL encounter — do not "fix" them:

- **`room.*` WS event names**: `room.markRead` (request) and `room.updated` (push) are retained
  compatibility event names (`src/application/websocket/registry.ts`,
  `handlers/messages/markReadHandler.ts`). Never rename wire event names casually.
- **`room` variable naming**: much backend code still calls a conversation `room` (`roomRepository`,
  `roomAudienceUserIds`, `pushToRoomAudience` in `src/application/websocket/conversationFanout.ts`,
  `src/main.ts`). This is internal naming only; DB tables and DTO fields use `conversation`.
- `users.app_role` is a **superseded** column from migration 0008; `system_role` (migration 0009) is
  authoritative. Do not read `app_role` in new code.
- Per-conversation membership roles
  (`conversation_memberships.role IN ('owner','moderator','member')`) are distinct from the global
  `system_role` — do not conflate them.

## 6. Architecture and dependency rules

Layers (see `docs/01-architecture.md` for rationale):

```
transport (Deno.serve, WS upgrade/read loop)
  → protocol (JsonCodec encodes/decodes envelopes)
  → application (RouteRegistry / WebSocketHandlerRegistry, per-endpoint handlers)
  → domain (services + policies, repository ports)
  → storage (Sqlite*Repository — all SQL)
```

Where things happen — put new logic in the same place:

- **HTTP validation**: inside each route handler using helpers from
  `src/shared/validation/validator.ts` (`asRecord`, `requireString`, `requireEnum`, …).
- **WS payload validation**: inside each event handler, same helpers.
- **Authentication context**: HTTP via `extractBearerToken`/`verifyAccessToken`
  (`src/application/middleware/authMiddleware.ts`); WS once at the upgrade
  (`src/transport/http/wsUpgrade.ts`, `?token=` query param, no in-band authenticate event).
- **Authorization**: domain policies — `PermissionService` (conversation access),
  `AdministrationPermissionService.require()` (operator permissions), `SanctionPolicy`,
  `BlockPolicy`, `RuntimePolicy`, `AccountPolicy`. The WS registry additionally gates every
  non-`system.pong` event through sanction + account checks, and `MUTATION_EVENTS` through
  `requireMutation` (`src/application/websocket/registry.ts`).
- **Transactions**: started in domain services (or handlers orchestrating multiple services) via
  `TransactionManager.run()` — never in repositories, never around mail or WS sends.
- **Pushes**: WS handlers emit pushes via `ConnectionManager` **after** the transaction commits,
  using `pushToRoomAudience`/`sendToUser`/`broadcastToAll`.
- **Database access**: only in `src/storage/repositories/**` behind a `*.port.ts` interface.
- **Errors**: throw typed errors (`src/shared/errors/*`, `safetyErrors.ts`,
  `administrationErrors.ts`); `translateError` (`src/application/middleware/errorBoundary.ts`) maps
  them to `{ code, message, details }` envelopes and hides internals as `INTERNAL_ERROR`.

Hard prohibitions:

- No raw SQL outside `src/storage/repositories/**` (and the migration runner in
  `src/storage/db.ts`).
- Never bypass a repository port or a domain policy "because the query is simple".
- Never push a WS event for state that has not committed yet.
- Frontend visibility (hidden buttons, capability flags) is **presentation**, never authorization.
- `JSON.stringify/parse` for client-facing payloads goes through `JsonCodec` only; the documented
  exemptions are log lines (`logger.ts`) and JWT internals (`tokenService.ts`).

## 7. Database and migrations

- `openDatabase()` in `src/storage/db.ts` opens/creates the SQLite file, sets
  `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`, creates `schema_migrations`, and applies
  every pending `db/migrations/NNNN_name.sql` in numeric order inside a `BEGIN/COMMIT`. Migration
  0005 additionally runs a TypeScript backfill (`backfillDirectConversationPairs`) — a special case
  hard-coded to version 5; ordinary migrations are pure SQL.
- Current migrations: `0001_init` (users/rooms/messages/… ), `0002_seed_channels` (4 fixed-UUID
  public channels), `0003_attachment_kind`, `0004_conversation_terminology` (rooms→conversations
  renames), `0005_direct_conversation_pairs`, `0006_attachment_ownership_and_security_foundation`,
  `0007_account_security_and_recovery` (token tables, session metadata, `email_verified_at`),
  `0008_user_safety_moderation_and_captcha` (blocks/reports/sanctions/audit, final-report triggers),
  `0009_backend_administration` (`system_role`, final-owner triggers, channel lifecycle,
  `system_settings`), `0010_session_client_metadata`, `0011_user_onboarding` (existing-user backfill
  and new-user preferences onboarding state), and `0012_user_locale_preference` (nullable explicit
  `en`/`tr` account locale). Migration count will grow — check the directory, don't trust this list
  as permanent.
- Major tables by domain: identity (`users`, `user_sessions`, `email_verification_tokens`,
  `password_reset_tokens`, `email_change_tokens`, `user_preferences`), conversations
  (`conversations`, `conversation_memberships`, `conversation_reads`, `direct_conversation_pairs`),
  content (`messages`, `reactions`, `attachments`, `notifications`), safety (`user_blocks`,
  `reports`, `user_sanctions`, `security_audit_events`), administration (`system_settings`).

Rules:

- **Never edit an already-committed migration file.** All schema changes are a new
  `db/migrations/NNNN_description.sql` with the next number. Existing data must be preserved (see
  the rename/backfill patterns in 0004/0006/0007).
- Test both paths: fresh database (all migrations from empty) and upgrade from an older version.
  `tests/support/testDatabase.ts` gives a fresh migrated temp DB; `tests/support/legacyDatabase.ts`
  builds a deterministic migration-0003 fixture — extend that pattern for upgrade tests
  (`tests/repository/directConversationPairsMigration.test.ts`).
- Use temporary database copies for any destructive verification. **Never reset, recreate, or mutate
  `storage/database/centrumchat.sqlite` (the live development DB) for tests.**
- After schema work run `PRAGMA foreign_key_check` and `PRAGMA integrity_check` on a migrated temp
  DB, and verify indexes/constraints exist as intended.
- Schema is never generated dynamically at runtime; every table originates from a numbered .sql
  file.

## 8. Transactions and concurrency

- `withTransaction` (`src/storage/db.ts`) is re-entrant: depth 0 uses `BEGIN/COMMIT`; nested calls
  use SAVEPOINTs with rollback-to-savepoint on error. `SqliteTransactionManager` implements the
  one-method `TransactionManager` port (`src/shared/transactions/transactionManager.ts`); domain
  services receive it by injection. Callbacks are synchronous (`run<T>(fn: () => T): T`) — do not
  `await` inside a transaction callback.
- SQLite is **single-writer**; keep transactions short and never perform network I/O (mail, fetch,
  WS sends) inside one.

Concurrency invariants enforced today — preserve all of them:

| Invariant                              | Mechanism                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One DM per user pair                   | `direct_conversation_pairs` UNIQUE + `CHECK (user_low_id < user_high_id)`; `DmService.openDm` catches the constraint violation and returns the winner (`src/domain/conversations/dmService.ts`) |
| Refresh rotation single-use            | `SqliteUserSessionRepository.rotate` — UPDATE guarded by current hash + not-revoked + not-expired; 0 changes ⇒ `UNAUTHORIZED`                                                                   |
| One-time security tokens               | `consumed_at` compare-and-set in the token repositories                                                                                                                                         |
| Report status transitions              | `expectedStatus → nextStatus` allow-list + CAS UPDATE (`SafetyService.transitionReport`)                                                                                                        |
| Role changes                           | `compareAndSetRole(targetId, expected, next)` guarded UPDATE (`sqliteAdministrationRepository.ts`)                                                                                              |
| Ownership transfer                     | two guarded UPDATEs inside one transaction (`transferOwnership`)                                                                                                                                |
| Final-owner protection                 | DB triggers `users_protect_final_owner_update/_delete` (migration 0009) plus application hierarchy checks                                                                                       |
| Admin edits of users/channels/settings | `admin_version` / `version` optimistic checks; stale version ⇒ `*_CONFLICT` error                                                                                                               |
| Owner bootstrap                        | `setRoleByEmailIfNoOwner` CAS at startup (`BOOTSTRAP_OWNER_EMAIL`, `src/main.ts`)                                                                                                               |
| Duplicate active reports               | partial UNIQUE indexes per target type (migration 0008)                                                                                                                                         |

## 9. Authentication and account security

Implemented in `src/domain/auth/authService.ts` + `tokenService.ts` + the routes under
`src/application/http/routes/auth/`.

- **Registration** (`POST /api/auth/register`): CAPTCHA-verified, gated by `registration_enabled`;
  creates the user, a session, and a hashed verification token in one transaction, then sends the
  verification mail **after commit**.
- **Login** (`POST /api/auth/login`): CAPTCHA-verified, generic `UNAUTHORIZED` on failure (no user
  enumeration), IP rate-limited.
- **Access tokens**: hand-rolled HS256 JWTs (Web Crypto, no library) with `sub` (user id), `sid`
  (session id), `username`, short TTL (`ACCESS_TOKEN_TTL_SECONDS`, default 15 min) even under
  remember-me.
- **Refresh tokens**: opaque 256-bit random values; only the SHA-256 hash is persisted
  (`user_sessions.refresh_token_hash`). Refresh rotates the token via CAS while preserving `sid`,
  `deviceLabel`, `remembered`, and the **absolute** `expires_at` (24h default / 30d remember-me).
- **Sessions**: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` (ownership-scoped),
  `POST /api/auth/sessions/revoke-others`, `POST /api/auth/logout`. `SessionCleanupJob` deletes
  expired/old-revoked rows on `SESSION_CLEANUP_INTERVAL_MS`.
- **Password change**: verifies current password, keeps the current session, revokes all others,
  sends a notice after commit. **Password reset / email verification / email change**: hashed
  single-use tokens (`0007` tables) with per-flow TTLs; links are built **only** from
  `PUBLIC_BASE_URL`.
- **Unverified accounts** (`AccountPolicy.requireVerifiedEmail`, toggled by the
  `email_verification_required` setting): may authenticate and manage their own account security,
  but cannot send messages, open DMs, create groups, add members, upload media, react, or use global
  user search.
- **Onboarding-incomplete accounts** may use authentication, recovery, verification,
  account-security, and `/api/auth/onboarding*` routes, but
  `AccountPolicy.requireOnboardingComplete` rejects the full application WebSocket and normal
  application mutations. Completion is computed from persisted preferences completion plus the
  runtime verification policy; the browser cannot set a completion flag.

Invariants that must never be weakened:

- Raw refresh/verification/reset/email-change tokens are **never persisted** — hashes only.
- Security links must never be constructed from `Host`, `Origin`, or forwarded request headers; only
  trusted `PUBLIC_BASE_URL`.
- Mail delivery happens outside transactions, after commit; mail failure must not roll back the
  committed security change (see `trySend*` helpers in `authService.ts`).
- Already-issued access tokens stay cryptographically valid until expiry after session revocation —
  by design (short TTL); runtime checks (`SanctionPolicy`, `RuntimePolicy`) still apply per request.
- Frontend token storage is browser-readable (`localStorage` for remember-me, `sessionStorage`
  otherwise — `web/scripts/shared-auth.js`); successful XSS remains a token-exposure risk. The CSP
  reduces but does not eliminate it.

## 10. HTTP and WebSocket security

### HTTP (`src/transport/http/httpServer.ts` + `src/application/http/`)

- Client IP is resolved centrally in `httpServer.ts` via the trusted-proxy policy in
  `src/shared/security/clientIp.ts`: the socket peer is the client unless that peer is listed in
  `TRUSTED_PROXY_IPS` (IPs/CIDRs), in which case `X-Forwarded-For` is walked right-to-left and the
  nearest untrusted entry wins; malformed/empty chains fall back to the socket IP.
  `CF-Connecting-IP`/`X-Real-IP` are never consulted. The resolved value feeds HTTP routes, IP-keyed
  rate limits, and the WS per-IP quota. **Do not parse forwarded headers anywhere else.**
- Deny-by-default CORS (`src/application/http/cors.ts`); same-origin always allowed; extra origins
  only via `ALLOWED_ORIGINS`.
- Security headers on every response (`src/shared/security/securityHeaders.ts`): nosniff, DENY
  framing, no-referrer, COOP/CORP, permissions-policy; CSP on `text/html` responses; HSTS only when
  `APP_ENV=production && PUBLIC_HTTPS=true` (never inferred from headers).
- Token-bucket rate limiting (`src/shared/rateLimit/rateLimiter.ts`) with one limiter per action
  category, keyed by IP or user, wired in `src/main.ts` (registration 5/5min, login 10/min, uploads,
  moderation 120/min, …). Guard helper: `src/application/http/rateLimitGuard.ts`.
- Multipart/body size limits enforced per media route from config + settings
  (`effectiveUploadLimit`).
- Generic error envelopes; unexpected errors surface only as `INTERNAL_ERROR`.
- `/health/live` = cheap liveness; `/health/ready` (and compatibility `/health`) = SQLite readiness.
- Static serving: `StaticRoute("*", web/)` resolves exact files, extensionless HTML siblings, and
  directory indexes while rejecting traversal. Do not place tests, fixtures, Markdown handoffs, or
  internal source material under public `web/`.

### WebSocket (`src/transport/http/wsUpgrade.ts`, `src/transport/websocket/*`)

- Auth happens **at the upgrade** (`GET /ws?token=`); invalid token ⇒ HTTP error, never a socket.
  There is no in-band authenticate event. Sanction (`requireApplicationAccess`) and account
  (`requireAccountAccess`) checks also run at upgrade.
- Browser `Origin` is validated against the same policy as CORS before upgrade.
- `ConnectionManager` (`connectionManager.ts`) is the **authoritative connection registry**: it owns
  admission (per-user and per-IP caps enforced before the 101), the single outbound send boundary,
  `bufferedAmount` backpressure (slow client is closed at `WS_MAX_BUFFERED_AMOUNT_BYTES`; healthy
  clients keep receiving), and idempotent cleanup. **Never call raw `socket.send()`/`socket.close()`
  outside it.**
- Transport read loop (`connection.ts`): inbound payload cap (`MAX_WS_MESSAGE_BYTES`),
  per-connection inbound token-bucket, protocol-violation strike counter
  (`WS_PROTOCOL_ERROR_LIMIT`), then exactly decode → dispatch → encode. It never inspects event
  names.
- Heartbeat is application-level and **centralized**: one `WebSocketLifecycleJob` sends
  `system.ping` pushes and closes idle sockets after `WS_IDLE_TIMEOUT_MS`. Clients answer with a
  normal `system.pong` request. **Do not add one timer per connection.** Valid inbound envelopes
  refresh the idle timer; malformed traffic does not (so garbage cannot keep a stale socket alive).
- `system.pong` is the one event exempt from sanction/maintenance gating (`registry.ts` `dispatch`)
  — a restricted account's socket must still be able to answer heartbeats. Preserve this exemption.
- Fanout (`conversationFanout.ts`): channels broadcast to all connected users; groups/DMs send only
  to membership rows. A failing/slow recipient must not abort delivery to others.
- Graceful shutdown closes all connections, stops jobs, then closes the DB (`src/main.ts`
  `shutdown()`).

Envelope protocol (`src/protocol/envelopes.ts`): inbound `{id, event, data}`; response echoes `id`
with `success` + `data|error`; pushes have no `id`. Unparseable input gets a `protocol.error` push.

## 11. Media and attachment rules

Routes in `src/application/http/routes/media/`; entity/service in `src/domain/attachments/`.

- Every upload persists `uploader_id` **from the verified token**, never from client input
  (migration 0006). `kind` is `attachment` (message media), `avatar`, or `cover`.
- Files live under `MEDIA_ROOT` (default `./storage`) addressed by a **server-generated relative
  path** (`mediaStorage.ts`) — no client-supplied names on disk, no path-traversal surface. Disk
  layout by kind: avatars → `profile/<uuid>` (`avatarRoute.ts`), covers → `cover/<uuid>`
  (`coverRoute.ts`), message uploads → `attachments/<uuid>` (`uploadRoute.ts`). The `kind` DB value
  (`avatar`/`cover`/`attachment`) is independent of the folder name. Storage paths are never exposed
  in any DTO (moderation context explicitly strips them).
- `GET /media/:id` (`serveMediaRoute.ts`): avatars/covers are served unauthenticated (inline,
  cacheable); `kind="attachment"` requires a valid token (`Authorization` header or `?token=`
  fallback) and, when message-bound, the same conversation access check as `message.history`. An
  unbound upload can be fetched only by its uploader. Attachments are served with
  `content-disposition: attachment` + `no-store`.
- Avatar/cover uploads must pass **magic-byte** image signature validation (PNG/JPEG/GIF/WebP only —
  `uploadValidation.ts`). SVG is not accepted for raster-image slots. Client MIME claims are never
  trusted; upload filenames are sanitized (`sanitizeUploadFileName`).
- Message/attachment binding happens transactionally in `MessageService` — only the uploader's own,
  not-yet-bound, `kind="attachment"` uploads may be attached to their message. Avatar/cover
  attachments must never be bound as message attachments.
- Orphan uploads (never attached) are swept hourly by a `setInterval` in `src/main.ts`
  (`sweepExpiredOrphans` + best-effort file delete). Failed persistence must clean up the file/row
  pair, not leave inconsistent state.
- Admin media resets (`ResetAdminMediaRoute` → `onMediaReset` in `src/main.ts`) clear the profile
  URL and delete the attachment row + disk file when it is a server-owned `/media/:id` asset.

## 12. Moderation, administration, and ownership

Four global roles in `users.system_role`: `user < moderator < admin < owner` (`ROLE_RANK`,
`src/domain/administration/permissionRegistry.ts`). Permissions inherit upward and are defined
**only** in that central registry:

- **Moderator** (`moderation.*`): view/assign/transition reports, view bounded report context, apply
  `message_mute` and `interaction_restriction` sanctions (expiry ≤ 30 days after start), revoke
  sanctions.
- **Admin** adds `moderation.sanctions.account_suspension` (immediate start required) and the
  `admin.*` family: users view/edit/sessions-revoke/force-password-reset/reset-media, channels
  view/create/update/archive/restore, moderator role assign/revoke, settings view/update, feature
  flags, registration policy, audit view.
- **Owner** adds the `owner.*` family: admin assign/revoke, ownership transfer, protected security
  settings (`email_verification_required`).

Rules that must hold for every privileged operation:

- Authority comes from the **persisted** `system_role` loaded per request
  (`AdministrationPermissionService.require`, `ModerationPolicy`); JWT claims and client-sent role
  fields grant nothing.
- Lower roles cannot alter equal-or-higher roles (`ROLE_RANK` comparison in
  `AdministrationService.setRole`); role changes and ownership transfer are CAS operations with
  `expectedRole`/`expectedVersion` inputs; the final owner is protected by DB triggers and code.
- Every privileged mutation is audited (`AdministrationService.audit`, `SafetyService.audit`).
- Role changes and suspensions force-close the target's live WS connections
  (`onRoleChanged`/`onAccountSuspended` hooks in `src/main.ts`).
- Frontend capability flags (`GET /api/control-center/me` → `areas`, `permissions`) are
  presentation-only.

Authoritative contracts: `docs/11-moderation-api-contract.md` (safety + moderation routes) and
`docs/12-control-center-api-contract.md` (administration/owner routes, DTO shapes, versioning).
Owner bootstrap: `BOOTSTRAP_OWNER_EMAIL` startup CAS (register the account first, restart once,
remove the variable); migration 0009 promoted the oldest admin when upgrading ownerless databases.

## 13. Blocking, reports, sanctions, and audit

All in `src/domain/safety/` + `src/application/http/routes/safety|moderation/`.

- **Blocking**: directional `user_blocks` rows; self-block rejected; enforcement is
  **bidirectional** for direct interaction (`BlockPolicy.requireDirectInteraction` — DM open, DM
  message send, group invites, notifications, profile/search reach). Existing DM history and shared
  group membership are preserved; only new direct interaction is refused (`BLOCKED_INTERACTION`).
  Block/unblock run in transactions.
- **Reports** (`POST /api/safety/reports`): targets `user|message|attachment`; reason codes and
  statuses are the fixed sets in `safety.entity.ts`. Creating a report requires the reporter can
  actually see the target (`requireReportTarget`) — private objects are not enumerable via the
  report endpoint. One active report per (reporter, target) via partial unique indexes. The receipt
  DTO never exposes reporter info to anyone but moderators; report context is bounded (≤20 messages
  each side, ≤41 total) and excludes credentials/tokens/unrelated conversations. Transitions follow
  the allow-listed state machine with CAS (`open → in_review → resolved|dismissed`, reopen from
  `in_review`).
- **Sanctions**: `message_mute` (cannot send/edit messages), `interaction_restriction` (also blocks
  DMs/reactions/invites), `account_suspension` (no application access; live sockets closed with code
  1008). Expiry uses server time (`SanctionPolicy` with injected `now`); revocation is recorded with
  actor + reason. Enforcement is applied on both HTTP routes and the WS dispatch gate.
- **Audit** (`security_audit_events`): append-oriented ledger; queried only through
  `GET /api/admin/audit-events` (requires `admin.audit.view`; moderators have no broad access).
  Metadata is bounded (≤4096 bytes JSON) and passes the same sensitive-key filtering as logs. It is
  **not** cryptographically tamper-proof against a direct DB operator — never claim otherwise.
- **CAPTCHA**: registration, login, and password-reset-request require a CAPTCHA verification
  (`developmentCaptchaVerifier` in dev, Turnstile in production; failures are audited and return
  `CAPTCHA_REQUIRED`).

## 14. System settings and runtime policy

Allow-listed, typed, versioned settings in `system_settings` (`SETTING_DEFINITIONS` in
`src/domain/administration/settingsService.ts`; the DB CHECK constraint in migration 0009 enforces
the same key list):

`registration_enabled`, `email_verification_required`, `maintenance_mode`, `max_message_length`,
`max_group_members`, `max_upload_size_bytes`, `max_avatar_size_bytes`, `max_cover_size_bytes`,
`allow_group_creation`, `allow_new_dm`, `default_channel_id`.

Rules:

- Precedence: environment variables are infrastructure/secrets; DB settings are runtime policy; code
  defaults are the fallback (`SettingsService.get` falls back to `defaultValue`).
- **No secrets in `system_settings`** — secrets live only in environment variables.
- Updates require the setting-specific permission and an `expectedVersion` CAS
  (`SETTING_UPDATE_CONFLICT` on staleness); all updates are audited.
- Upload-size settings are capped by the environment limits (`SettingsService.effectiveUploadLimit`
  takes the minimum) — a DB setting can never exceed infrastructure.
- `default_channel_id` must reference an existing **active** channel.
- `maintenance_mode` blocks mutations for everyone via `RuntimePolicy.requireMutation` (reads and
  `system.pong` still work); `registration_enabled=false` rejects registration with
  `REGISTRATION_DISABLED`; archived channels reject mutations via `requireChannelMutation`.
- No setting currently requires a restart (`restartRequired: false` for all); adding one that does
  must surface that flag.
- Adding a new setting requires: the `SETTING_DEFINITIONS` entry, a **new migration** extending the
  `system_settings` CHECK + seed row, contract doc updates, and Control Center support.

## 15. Frontend applications

### Shared auth UI — `web/auth.html`, `web/scripts/auth*.js`, `web/styles/auth.css`

The auth page owns sign-in, registration, recovery/security-link callbacks, onboarding, safe
same-origin `returnTo`, and Control Center permission-denied behavior. `shared-auth.js` is the only
browser implementation of token storage, refresh serialization, authenticated fetch, account
resolution, destination validation, and protected-page guards. Auth strings use the small keyed
catalog in `auth-i18n.js`: English is the default/fallback and Turkish is selected from the browser
locale when available. Chat and Control Center consume these modules rather than reimplementing
token or refresh behavior.

### Main chat UI — `web/index.html`, `web/scripts/chat*.js`, `web/styles/chat.css`

Plain HTML/CSS/JS modules, Bootstrap/fonts from the CDN allow-list in the CSP. Tokens:
`localStorage` for remember-me, `sessionStorage` otherwise. One HTTP client wrapper and one WS
client; the WS client answers `system.ping` with `system.pong` fire-and-forget. Normal-user safety
only: block/unblock and report message/attachment/user. It must never reference `/api/moderation/*`
or `/api/admin/*`.

### Legacy moderation console

**Does not exist in this checkout.** There is no `web/admin/` directory; `/admin` is intentionally
not found. Do not create one, and do not describe it as present.

### Control Center — `web/control-center.html`, `web/scripts/control-center*.js`

Operator UI served at `/control-center`. This checkout uses flat `control-center*.js` modules; there
is no nested `web/control-center/` instruction boundary.

- All capability/identity state comes from `GET /api/control-center/me`; capabilities gate
  **rendering only** — the backend re-authorizes every call.
- `control-center-api.js` is the HTTP adapter and must consume `shared-auth.js`; there is no fixture
  fallback, URL/storage role switcher, or development activation path.
- Adapters must not invent endpoints, DTO fields, cursors, or version fields; unavailable backend
  capability stays unavailable in the UI.
- Untrusted data is rendered with safe DOM construction (`textContent`/element building — see
  `ui/common.js`), not string-interpolated `innerHTML`.
- Cursor pagination and optimistic-version conflicts follow the contract docs; conflict responses
  re-fetch rather than retry blindly. Sensitive state is cleared on logout.
- Verify Control Center presentation and interactions manually; do not add automated frontend tests
  anywhere in the repository.

## 16. API contracts and compatibility

| Surface                                                    | Authoritative document                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| WebSocket events (full catalog, envelopes, pushes)         | `docs/03-websocket-events.md`            |
| HTTP API (auth, sessions, recovery, media, health, config) | `docs/04-http-api.md`                    |
| Safety + moderation routes and DTOs                        | `docs/11-moderation-api-contract.md`     |
| Control Center administration/owner routes and DTOs        | `docs/12-control-center-api-contract.md` |

Production code remains authoritative over all of them. A contract change is atomic: backend +
frontend + backend tests + the contract document change in the same task. Frontend behavior is
verified manually and must not gain an automated test suite. Stable error codes (§6 list:
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`,
`BLOCKED_INTERACTION`, `MESSAGE_MUTED`, `INTERACTION_RESTRICTED`, `ACCOUNT_SUSPENDED`,
`CAPTCHA_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, `PERMISSION_DENIED`, the `*_CONFLICT` family,
`REGISTRATION_DISABLED`, `MAINTENANCE_MODE`, `INTERNAL_ERROR`, …) must be preserved; clients branch
on them. Cursor formats and version fields come from the server — never guessed. Compatibility event
names (`room.markRead`, `room.updated`, the `/health` alias) must not be renamed.

## 17. Coding conventions

Backed by multiple existing examples — follow them:

- **Files**: camelCase TypeScript file names (`sendMessageHandler.ts`, `sqliteUserRepository.ts`);
  domain folders by concept; ports as `<name>Repository.port.ts`; entities as `<name>.entity.ts`.
- **Classes**: `PascalCase`; SQLite implementations are `Sqlite<Port>Repository`; HTTP handlers are
  `<Action>Route` implementing `RouteHandler` (`method`, `path`, `handle`); WS handlers are
  `<Action>Handler` implementing `EventHandler` (`event`, `handle`).
- **Errors**: subclass `DomainError` with a `readonly code = "SCREAMING_SNAKE"`; message text is
  user-safe; details carry structured fields.
- **DTOs/entities**: `readonly` interface properties; snake_case in SQL rows mapped to camelCase via
  explicit `toRecord`/row-mapping functions in each repository.
- **Timestamps**: ISO-8601 UTC strings (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` in SQL,
  `new Date().toISOString()` in code). **IDs**: UUIDs from `generateId()` (`src/shared/id.ts`).
- **Async**: repositories and domain services are synchronous (node:sqlite is sync); async appears
  only at transport/crypto/file/mail boundaries. Transaction callbacks are synchronous.
- **DI**: constructor injection wired exclusively in `src/main.ts`; domain services accept an
  options object when the dependency list is long (`AuthService`, `SafetyService`).
- **Validation**: `src/shared/validation/validator.ts` helpers; every handler validates its own
  payload before touching services.
- **Logging**: `logger.child("module", context)` per component; structured context objects, no
  string interpolation of data into messages.
- **Tests**: `Deno.test("plain-language behavior description", …)`; unit tests use in-memory fakes
  from `tests/support/`; integration tests boot the real server on port 0 with a temp SQLite file
  and tear down in `finally`.
- **Frontend**: auth, chat, and Control Center are vanilla-JS ES modules under `web/scripts/`. They
  are excluded from root `deno fmt`/`deno lint`; match local style and verify manually.
- Comments explain _why_ (with doc-section references), not _what_.

## 18. Logging and secret handling

`src/shared/logging/logger.ts` is the only logging mechanism: JSON lines to stdout/stderr with
central redaction. Sensitive keys (normalized) are replaced with `[REDACTED]`: password variants,
access/refresh tokens and hashes, `authorization`, `cookie`, verification/reset tokens, `jwtSecret`,
`secret`. Sanitization is bounded: depth 5, 200 nodes, 50 props/object, 50 array elements, 1024-char
strings, circular-safe. Error stacks are included only outside production (`includeErrorStacks` in
`src/main.ts`).

Rules:

- No `console.log` in production `src/**` code paths — use the injected logger (the codebase has
  zero direct console calls outside the logger).
- Production logs (and audit metadata) must never contain: passwords, Authorization headers, access
  or refresh tokens, verification/reset/email-change tokens, CAPTCHA responses, provider secrets
  (`RESEND_API_KEY`, `CAPTCHA_SECRET_KEY`, `JWT_SECRET`), private message bodies by default, or full
  token-bearing links.
- If you introduce a new secret-shaped field, add its normalized key to `SENSITIVE_KEYS` in the same
  change.

## 19. Testing and verification

Suites (`tests/`, all run by `deno task test`):

- `tests/unit/` — domain services against in-memory fakes.
- `tests/integration/` — full server boot (`startHttpServer` + real WS clients via
  `tests/support/wsTestClient.ts`) against a per-test temp SQLite file, ephemeral port.
- `tests/protocol/` — codec/envelope shape. `tests/repository/` — each `Sqlite*Repository` against a
  temp DB, including migration-upgrade tests.

Frontend code under `web/` has no automated suite. Do not add or restore static, behavioral, or
browser frontend test files under `tests/`, `web/`, or another directory; verify frontend changes
manually. Do not create or restore `web/control-center/tests/`.

Every final report for work that changes frontend code must state exactly:
`kullanıcı frontend testlerini istemiyor`. Report frontend verification as manual browser checks,
and mark any requested frontend-only automated suite as `NOT APPLICABLE` rather than recreating it.

Standard verification before declaring success on any code change:

```bash
deno task fmt          # or: deno fmt --check for verification only
deno task check
deno task lint
deno task test
```

Tests need `--allow-net --allow-env --allow-read --allow-write` (already in the task); integration
tests bind localhost ports.

Run the full suite **three consecutive times** (races are timing-sensitive) when touching:
concurrency-sensitive code, migrations, authentication/sessions, WebSocket lifecycle,
roles/permissions, versioned settings/channels, moderation/report transitions, or cross-module
integration.

Focused verification expectations by area: migration upgrade path + `PRAGMA foreign_key_check` +
`PRAGMA integrity_check` (schema work); DM-open race (`dmService`/`directConversationPairs` tests);
refresh-rotation race (`accountSecurity`/`auth` tests); token single-use; role/owner CAS races
(`administration.test.ts`); settings/channel version conflicts; connection caps + backpressure
(`connectionManager.test.ts`, `websocket.test.ts`); private media authorization (`media.test.ts`).

Never weaken or delete a failing test to get green; never claim a test you could not run passed;
always use temp DBs for migration tests, never `storage/database/centrumchat.sqlite`.

## 20. Parallel-agent coordination

When work is split across agents:

- Every parallel task must declare **exclusive file ownership** up front; no two agents edit the
  same file.
- Backend agents own schema, domain truth, authorization, and API semantics (`src/**`, `db/**`,
  `tests/**` for backend behavior). Frontend agents own presentation and adapter consumption
  (`web/**`). Frontend must not invent backend behavior that doesn't exist; backend must not shape
  domain APIs around imagined screens — the contract docs are the meeting point.
- Shared documents (`docs/03|04|11|12`, this file) get one named owner per task set.
- Do not run root-wide `deno fmt` while another agent is editing overlapping files.
- Failures observed outside your ownership boundary are reported, not "fixed".
- A final integration agent reconciles contracts (backend ↔ frontend ↔ docs ↔ tests) after parallel
  work completes.

Reusable ownership template:

```text
Agent A (backend) owns:
- src/domain/<area>/**, src/storage/repositories/<repo>.ts, db/migrations/00NN_*.sql
- tests/unit|integration|repository/<area>*.test.ts
Agent B (frontend) owns:
- web/control-center.html, web/scripts/control-center-<area>.js
Forbidden overlap:
- docs/12-control-center-api-contract.md (owned by Agent A), src/main.ts wiring (Agent A)
Authoritative contract:
- docs/12-control-center-api-contract.md as updated by Agent A before Agent B consumes it
```

## 21. Forbidden actions

- Do not perform Git operations (commit, branch, push, reset) unless explicitly requested.
- Do not edit already-applied migration files; schema changes are always a new numbered migration.
- Do not reset, recreate, or test against `storage/database/centrumchat.sqlite` or delete files
  under `storage/`.
- Do not add an ORM, Redis, a web framework, or any new runtime dependency without explicit
  architectural approval — production `src/**` is dependency-free by design.
- Do not rename canonical conversation terminology or wire-compatibility names (`room.markRead`,
  `room.updated`, `/health`).
- Do not trust client-supplied role, permission, capability, or uploader-identity fields anywhere.
- Do not bypass repository ports, domain policies, or the central permission registry.
- Do not emit WS pushes or send mail inside a database transaction / before commit.
- Do not build security links from `Host`/`Origin`/forwarded headers; only `PUBLIC_BASE_URL`.
- Do not store secrets in `system_settings` or expose `storage_path` in any DTO.
- Do not invent API endpoints, DTO fields, cursors, or version fields in frontend adapters.
- Do not add a fixture fallback or a URL/storage fixture toggle to the Control Center.
- Do not weaken CSP, Origin validation, CORS, rate limits, WS size/rate/connection limits,
  attachment authorization, or the logger's redaction set.
- Do not claim audit records are cryptographically tamper-proof.
- Do not perform broad refactors inside focused security fixes, or mix unrelated feature work into
  migration/integration tasks.
- Do not create nested `AGENTS.md` files without a task that calls for them.

## 22. Known limitations (current, verified — preserve or address explicitly)

- Revoking a session does not invalidate already-issued access tokens; they stay valid until their
  short expiry (stateless JWT by design). Runtime sanction/account checks still apply per request.
- Browser-readable token storage (`localStorage`/`sessionStorage`) is exposed to successful XSS; the
  CSP mitigates, not eliminates.
- Mail dispatch is fire-and-forget after commit (`trySend*` in `authService.ts`) — there is no
  durable mail queue; a failed send is logged, not retried.
- Audit events are append-oriented but not cryptographically protected from a direct DB operator.
- SQLite is single-writer; the in-memory `ConnectionManager`, presence, typing, and rate-limiter
  state are single-process — no horizontal scaling.
- Orphan-attachment cleanup is a process-lifetime `setInterval` (`src/main.ts`); it does not survive
  a restart mid-window.
- Private channels and channel hard-deletion are intentionally unsupported (channels archive only —
  `docs/12`).
- Resend (mail) and Turnstile (CAPTCHA) production adapters can only be fully verified against the
  live external services; development adapters are used everywhere else, and production config
  rejects them.
- There is no legacy `web/admin/` console; `/admin` is a deliberate 404.

## 23. Standard task workflow

Full (backend or cross-cutting) task:

1. Read this file, then the relevant contract doc (§16) and design doc.
2. Inspect the production code you will change; verify docs against it.
3. Define scope and file ownership (especially if parallel agents exist).
4. If the task changes a contract, update the contract document first (or atomically with code).
5. Implement the smallest coherent change; new schema = new migration.
6. Add regression tests beside the existing backend suite for backend behavior. Frontend behavior is
   manually verified and must not add automated frontend test files anywhere in the repository.
7. Run focused tests for the touched area, then the full §19 verification; 3× full runs for
   concurrency-sensitive areas.
8. Report results exactly, including anything unverifiable (external services, live deploys).

Documentation-only task: verify every claim against production code, change only the assigned
document, run `deno fmt --check <file>` (root Markdown is formatted; `docs/` is fmt-excluded).

Frontend-only task: respect §15 boundaries, change only `web/**` you own, keep the public
`StaticRoute` behavior in mind for new assets, run the backend suite for regression coverage, and
manually verify the affected frontend flows. Do not add automated frontend test files anywhere in
the repository.

## 24. Source-of-truth references

| Topic                                               | Reference                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Layering, protocol seam, presence/permissions model | `docs/01-architecture.md`                                                                         |
| Original schema design / current schema snapshot    | `docs/02-database-schema.md`, `docs/08-current-database-schema.md` (historical review: `docs/07`) |
| WS event catalog                                    | `docs/03-websocket-events.md`                                                                     |
| HTTP API                                            | `docs/04-http-api.md`                                                                             |
| Folder structure / build phases                     | `docs/05-folder-structure.md`, `docs/06-implementation-plan.md`                                   |
| Implemented security controls                       | `docs/09-public-internet-security.md`                                                             |
| Safety/moderation design                            | `docs/10-moderation-and-user-safety.md`                                                           |
| Moderation API contract                             | `docs/11-moderation-api-contract.md`                                                              |
| Control Center API contract                         | `docs/12-control-center-api-contract.md`                                                          |
| Control Center integration boundary                 | `web/control-center.html`, `web/scripts/control-center-contract.js`, `docs/12`                    |
| Environment variables                               | `.env.example`, `src/shared/config/config.ts`, `README.md` table                                  |
| Composition/wiring ground truth                     | `src/main.ts`                                                                                     |
