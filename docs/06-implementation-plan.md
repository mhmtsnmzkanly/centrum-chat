# CentrumChat Server — Implementation Plan

Each phase ends in a runnable, tested state. Phases are ordered so every later phase can lean on a
working slice of the architecture rather than stubbing it out.

## Phase 0 — Scaffold
- `deno.json`, import map, lint/fmt config, `.env.example`.
- `shared/config`, `shared/logging`, `shared/errors`, `shared/id`.
- `storage/db.ts`: SQLite open, PRAGMAs (WAL, foreign_keys), migration runner.
- `db/migrations/0001_init.sql`: full schema from `02-database-schema.md`.
- `GET /health` end to end (proves transport → storage wiring).
- Repository test harness (temp SQLite file per test).

## Phase 1 — Protocol & Transport skeleton
- `protocol/protocolCodec.ts`, `jsonCodec.ts`, `envelopes.ts`.
- `transport/websocket/connectionManager.ts`, `connection.ts` (decode → registry.dispatch → encode loop).
- `application/websocket/eventHandler.ts`, `registry.ts` with zero handlers registered yet.
- `transport/http/wsUpgrade.ts` stubbed to accept any socket (real auth check added Phase 2).
- Protocol tests: encode/decode roundtrip, malformed JSON, unknown event → `VALIDATION_ERROR`/`NOT_FOUND` envelope.

## Phase 2 — Authentication & Sessions
- `domain/auth`: password hashing (Deno's `std/crypto` or `bcrypt`-equivalent), JWT sign/verify, refresh-token issue/rotate/revoke.
- `storage/repositories/sqliteUserRepository.ts`, `sqliteRefreshTokenRepository.ts`.
- HTTP routes: register, login, refresh, logout.
- Wire real token validation into `wsUpgrade.ts`.
- `application/middleware/authMiddleware.ts` attaches `userId` to `HandlerContext` for all WS handlers.
- Integration test: register → login → open WS with token → upgrade succeeds; bad/expired token → upgrade rejected.

## Phase 3 — Users, Presence, Profile, Preferences
- `domain/users`, `domain/presence`, `domain/preferences`.
- WS handlers: `presence.update`, `profile.get`, `profile.update`, `preferences.get`, `preferences.update`.
- Connection Manager presence transitions (online on first connect, offline+lastSeenAt on last disconnect) + `presence.updated` broadcast.
- Unit tests for presence transition logic against fake repos.

## Phase 4 — Rooms: Channels, Groups, DMs, Permissions
- `domain/rooms` (`channelService`, `groupService`, `dmService`), `domain/permissions`.
- `storage/repositories/sqliteRoomRepository.ts`.
- Seed the 4 default public channels (`general`, `programming`, `technology`, `gaming`) as `rooms` rows.
- WS handlers: `channel.list` (no join/leave — channels are public, see architecture doc §13), `group.list/create/addMember/removeMember/leave`, `dm.open/list`.
- `permissionService`: open access for `channel` rooms, `room_members`-gated for `group`/`dm` — unit tested directly since it's the single place authorization branches.
- Group business rules (3–25 members, ownership transfer, system messages) as domain-layer unit tests — this is the highest-value test surface since it's pure logic ported from the frontend's rules.
- Privacy enforcement (`dmPrivacy`/`groupPrivacy`) as its own testable policy function.

## Phase 5 — Messaging Core
- `domain/messages`, `storage/repositories/sqliteMessageRepository.ts`, `sqliteRoomReadRepository.ts`.
- WS handlers: `message.send/edit/delete/history`, `room.markRead` (upserts `room_reads`, works uniformly across channel/group/dm).
- Fan-out via Connection Manager: `message.new`/`message.updated` broadcast to all connections for channels, to `room_members` only for group/dm; `unread.updated` pushed per-recipient.
- Rate limiter wired into `message.send`.
- Integration test: two WS clients in the same room, one sends, the other receives `message.new` within the same test process.

## Phase 6 — Reactions & Typing
- `domain/reactions`, `domain/typing` (in-memory expiry timers).
- WS handlers: `reaction.toggle`, `typing.start/stop`.
- Unit test for typing auto-expiry (fake clock).

## Phase 7 — Attachments & Media Upload
- `domain/attachments`, `storage/repositories/sqliteAttachmentRepository.ts`.
- HTTP routes: `/api/media/upload`, `/api/media/avatar`, `GET /media/:id` (streamed).
- Orphan-attachment cleanup job (scheduled via `setInterval` at boot, documented as a non-goal to make durable/cron-based in this reference implementation).
- Integration test: upload → attach via `message.send` → fetch back via `GET /media/:id`.

## Phase 8 — Notifications & Search
- `domain/notifications`, `domain/search`, `storage/repositories/sqliteNotificationRepository.ts`.
- WS handlers: `notification.list/markRead`, `search.messages/users`.
- Notification creation hooked into `message.send` (DM, @mention detection, group invite).

## Phase 9 — Hardening
- Full error-boundary audit: every handler path returns the standard envelope, nothing throws raw.
- Rate limiter applied to remaining write-heavy events (`reaction.toggle`, `group.create`, etc.).
- Structured logging pass: request-scoped log context (userId, connectionId) threaded through handlers.
- Load-test the WS fan-out path informally (many connections in one room) to sanity-check the Connection Manager's broadcast isn't O(n²) anywhere.

## Phase 10 — Test suite completion & docs
- Fill any coverage gaps across unit/integration/protocol/repository suites.
- README: run instructions, env vars, migration commands.
- Final pass against this doc set to confirm no drift between design and implementation.

## Phase 11 — Frontend integration (web/)
- Copy integrated plain HTML/CSS/JS frontend to the project root's `web/` directory.
- Implement static file routes to serve `web/index.html`, `index.css`, `index.js` directly from Deno.
- Replace client-side fake storage and mock behaviors with real HTTP and WebSocket client calls.
- Implement data shape reconciliation adapters on the client side.
- Add backend support for change-password (`POST /api/auth/change-password`), cover image upload (`POST /api/media/cover`), profile `isPremium` update support, and WebSocket `group.members` event.
- Run all format, check, lint, and test suites, validating backend changes.
- Integration notes from the live browser pass (lime-csr-js 0.1.4 specifics):
  - `store.computed` callbacks receive no arguments — always read dependencies via `store.get`.
  - A live block (`<for data-live>`/`<if data-live>`) placed inline inside a live `<if>` branch
    renders once at branch build but never re-subscribes; tab panels therefore use `data-show`
    (visibility toggle, always-in-DOM) instead of `<if data-live>` so the lists inside stay reactive.
  - `<img src="${...}">` in a template fetches the literal placeholder the moment the fragment is
    cloned (detached `<img>` elements load eagerly); all interpolated images carry `loading="lazy"`.
  - `<for>` inside `<select>` is dropped by the HTML parser; the add-member options are built
    imperatively.
  - Attachment images/downloads pass the access token as a `?token=` query param on `GET /media/:id`
    (an `<img>` cannot send an `Authorization` header) — see `04-http-api.md`.
- Bootstrap swallows `Modal.hide()` (including `data-bs-dismiss` clicks) while the show transition
    is still running; the client wraps modal open/close in transition-safe helpers.

## Phase 12 — Conversation and session terminology migration
- Documentation update: schema, API, websocket event, and folder-structure docs move from `room`/`refresh token` terminology to `conversation`/`user session` terminology where the shared chat container or persisted session is meant.
- Additive SQLite migration: rename `rooms` → `conversations`, `room_members` → `conversation_memberships`, `room_reads` → `conversation_reads`, and `refresh_tokens` → `user_sessions`, including the relevant foreign-key columns and explicit index names.
- Repository and domain rename: internal ports, entities, services, and SQLite implementations adopt `Conversation*` and `UserSession*` terminology while preserving the same behavior.
- Compatibility handling: update the integrated frontend and backend together so wire payloads use `conversationId` instead of `roomId`, with no long-lived alias layer.
- Verification: fresh-database migration, existing-database migration, foreign-key check, integrity check, and the project task suite.

## Phase 13 — Database integrity and lifecycle hardening
- Documentation update: call out canonical DM pair storage, transactional workflow boundaries, and the session cleanup lifecycle in the architecture and schema docs.
- Additive SQLite migration: add `direct_conversation_pairs` to enforce one canonical DM pair per conversation and backfill it from existing valid DM rows.
- Repository and domain hardening: centralize canonical pair ordering, make DM creation atomic, wrap multi-step group/message workflows in SQLite transactions, and keep message attachment binding inside the same commit boundary.
- Compatibility handling: preserve existing public event names and message payloads; only the persistence model changes.
- Lifecycle handling: run a startup session-cleanup pass, schedule periodic cleanup from configuration, and stop the timer on graceful shutdown.
- Verification: fresh-database migration, existing-database migration, foreign-key check, integrity check, unit tests, integration tests, and task-suite execution.

## Phase 14 — Security foundation hardening
- Documentation update: record attachment ownership, transport-layer origin/CORS policy, security headers, upload validation, and HTTP/WS abuse controls.
- Additive SQLite migration: add `attachments.uploader_id`, backfill legacy rows where ownership can be derived, and index ownership lookups.
- Repository/domain hardening: require uploader ownership before attaching or reading pending uploads, while preserving conversation-based access once an attachment is bound to a message.
- Transport hardening: add deny-by-default CORS handling, explicit WebSocket `Origin` validation, HTTP access logging, fixed security headers, transport-level WS payload/rate/protocol-abuse guards, and route-level HTTP rate limits for sensitive endpoints.
- Upload hardening: sanitize filenames, verify image uploads by actual file signature, and serve ordinary attachments with download-oriented headers.
- Configuration hardening: validate environment mode, allowed origins, JWT secret quality in production, and WS abuse-threshold settings.
- Verification: fresh/existing database migration checks, targeted security integration tests, and full format/check/lint/test execution.

## Phase 15 — WebSocket DoS Protection and Operational Security Hardening
- Documentation update: record concurrent WebSocket admission limits, outbound backpressure policy, application-level heartbeat behavior, stale-connection cleanup, conditional HSTS, structured-log redaction, and split liveness/readiness probes.
- Connection admission hardening: atomically enforce configured concurrent WebSocket caps per authenticated user and per peer IP before the upgrade completes, with idempotent cleanup on every close path.
- Outbound WS hardening: route every production socket write through one `ConnectionManager` send boundary that checks `bufferedAmount`, isolates send failures, and closes slow clients once the configured buffered-byte threshold is exceeded.
- Lifecycle hardening: add one shared WebSocket heartbeat/stale-socket job (`system.ping` / `system.pong`, no native protocol ping claim), stop it during graceful shutdown, and close remaining sockets with server-driven cleanup.
- HTTP/security hardening: emit HSTS only when `APP_ENV=production` and public HTTPS is explicitly asserted; never trust forwarded headers to infer TLS.
- Logging hardening: add centralized structured-log redaction with bounded recursion/truncation and repair call sites that were passing raw error strings instead of structured error objects.
- Health hardening: split `GET /health/live` and `GET /health/ready`, keep `/health` as a readiness compatibility alias, and keep failure responses generic while logging detail server-side.
- Verification: focused unit/integration tests for connection caps, backpressure isolation, stale-connection cleanup, HSTS gating, logger redaction, and health semantics, followed by repeated full task-suite runs.

## Phase 16 — Account Security, Verification, and Recovery
- Documentation was updated alongside the implementation so auth/session, schema, websocket, HTTP,
  folder-structure, and public-security docs reflect the actual session-management, remember-me,
  verification, reset, and email-change flows now present in production code.
- `user_sessions` now stores `remembered` and `last_used_at`, access tokens carry trusted `sid`
  claims, and authenticated HTTP routes list active sessions, revoke one session, and revoke all
  other sessions without exposing token hashes.
- `rememberMe` is explicit input on register/login. Non-remembered sessions use
  `SESSION_DEFAULT_TTL_MS`; remembered sessions use `SESSION_REMEMBERED_TTL_MS`; refresh rotation
  preserves absolute expiry by updating the same persisted session row in place.
- Mail delivery now goes through a typed mail-service port with a development adapter, test fake,
  and a production `resend` adapter. Security links are built only from `PUBLIC_BASE_URL`, and
  production validation rejects the development adapter.
- Email verification is fully implemented: `users.email_verified_at`, hashed verification tokens,
  post-registration mail delivery, authenticated resend with previous-token invalidation, and atomic
  token consumption.
- Verified-email enforcement is centralized in `AccountPolicy.requireVerifiedEmail(userId)` and
  wired into the sensitive HTTP media routes plus sensitive WS handlers (`message.send`, `dm.open`,
  `group.create/addMember/removeMember`, `reaction.toggle`, `search.users`).
- Password recovery is fully implemented: hashed reset tokens, enumeration-resistant request
  responses, atomic reset completion, revocation of all sessions, invalidation of other active reset
  tokens, and a post-commit password-changed notice.
- Email change is fully implemented as a pending-token workflow requiring current-password
  reauthentication, new-email verification before `users.email` is updated, and an old-email notice
  after commit.
- The existing cleanup lifecycle now also purges expired or consumed verification/reset/email-change
  tokens without introducing per-token timers.
- Focused unit, repository, integration, static frontend, adversarial, and migration-verification
  tests cover session ownership, remember-me lifetime, verification/reset concurrency,
  host-injection resistance, unverified-account enforcement, and development-mail secret hygiene.

## Explicit non-goals (call out, don't silently skip)
- Horizontal scaling / multi-process pub-sub for the Connection Manager.
- EnfCodec implementation itself (only the seam for it).
- Wiring the actual frontend at `/home/duldul/Belgeler/chat` (per your decision: server-only, no bridge script).
- Payment/verification flow behind `isPremium` (stays a plain boolean flag, as in the frontend).
# Phase: User Safety, Moderation Enforcement, and Abuse Protection

- Add persisted server-owned user/moderator/admin roles without a generic RBAC subsystem.
- Add directional blocks with transactional DM/send enforcement and discoverability filtering.
- Add constrained user/message/attachment reports, compare-and-swap workflow transitions, and safe
  bounded moderator context.
- Add message mute, interaction restriction, and account suspension with trusted-time expiry and
  immediate active-socket suspension enforcement.
- Add append-oriented bounded/redacted moderation audit events and admin-only cursor queries.
- Add development/test/Turnstile CAPTCHA adapters for registration, login, and password-reset request.
- Publish backend-only moderation contracts; operator/admin visual design remains independently owned.

# Phase: Backend Administration and Permission Architecture

- Extend persisted authority to `user`, `moderator`, `admin`, and final-owner-protected `owner`.
- Centralize role-to-permission mapping and reload authority for every privileged operation.
- Add CAS-protected user administration, channel lifecycle, and fixed non-secret runtime settings.
- Add owner-only admin assignment/ownership transfer and audit every privileged mutation.
- Publish a backend-only Control Center contract without modifying either administration frontend.

# Phase: Control Center Contract Reconciliation and Production Integration

- Reconcile every Control Center adapter and controller with the implemented moderation and
  administration HTTP contracts, including cursor pagination and expected-state/version fields.
- Derive presentation capabilities exclusively from the authoritative operator response; persisted
  backend permissions remain the authorization boundary.
- Integrate the existing browser credential policy, clear sensitive state after access loss, and do
  not automatically replay destructive requests after token refresh.
- Serve only an explicit allow-list from `web/control-center/`; fixture, test, and handoff files stay
  private while existing `/admin` route behavior remains unchanged.
- Preserve conflict input for explicit resubmission and invalidate stale list/detail responses.
- Verify static routes, production-route mappings, fixture isolation, frontend security properties,
  and the complete repository suite.
