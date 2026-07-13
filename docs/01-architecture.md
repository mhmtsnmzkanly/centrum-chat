# CentrumChat Server — Architecture

## 0. Context and a resolved ambiguity

The reference frontend (`/home/duldul/Belgeler/chat`) was analyzed in full. It turned out to be a
pure client-side simulation — no `WebSocket`, no `fetch`, everything persisted to `localStorage`.
There is therefore no existing wire protocol to reverse-engineer. Per instruction, the frontend is
left completely untouched and out of scope for this project; this document designs a real protocol
from scratch, using the frontend's domain model (User, Message, Group, Channel, Reaction,
Attachment, Preferences, etc. — field names and enums) as a naming reference so a future bridge
layer has an easy mapping if one is ever built.

**Resolved spec ambiguity:** the brief's WebSocket section lists `login → LoginHandler` as an
example of the handler-registration pattern, while the HTTP section says HTTP should exclusively
own Authentication. Resolution: **Authentication (register/login/refresh/logout) is HTTP-only**,
returning an access JWT + refresh token. The WebSocket upgrade request authenticates using that
JWT (`?token=` query param, validated before the upgrade completes). Everything else — channels,
groups, DMs, messages, reactions, typing, notifications, search, profile, preferences — is
WebSocket-only, per the brief. The `login`/`LoginHandler` example is read as illustrating the
*handler registration pattern itself*, applicable equally to HTTP route handlers.

## 1. Layered architecture

```
Transport Layer      Deno.serve HTTP + WebSocket upgrade. No business logic. No SQL.
      ↓
Protocol Layer        ProtocolCodec (encode/decode envelopes). No business logic.
      ↓
Application Layer     One handler per WS event / one controller per HTTP route.
                       Orchestrates domain services, enforces authz, shapes responses.
      ↓
Domain Layer           Pure business logic (entities, use-case services). No I/O,
                       no knowledge of HTTP/WS/JSON. Depends only on repository
                       interfaces (ports), not concrete SQLite code.
      ↓
Storage Layer          Repository implementations. All SQL lives here, nowhere else.
      ↓
SQLite
```

Dependency rule: each layer may depend only on the layer(s) below it, never above, and every layer
depends on **interfaces** declared by the layer beneath it (ports/adapters), not concrete
implementations, so the domain layer is fully unaware of Deno, SQLite, JSON, or WebSocket. This is
what lets `EnfCodec` replace `JsonCodec` in v2.0 by swapping one binding in the composition root —
zero changes to `application/` or `domain/`.

## 2. Protocol abstraction

```ts
interface ProtocolCodec<TIncoming, TOutgoing> {
  decode(raw: string | Uint8Array): TIncoming;
  encode(message: TOutgoing): string | Uint8Array;
}
```

`JsonCodec implements ProtocolCodec<InboundEnvelope, OutboundEnvelope>` is the only place
`JSON.parse`/`JSON.stringify` may appear in the entire codebase — enforced by a lint rule
(`no-restricted-syntax` on `JSON.parse`/`JSON.stringify` outside `src/protocol/**`) checked in CI.
`EnfCodec` (v2.0, not built now) will implement the same interface against a binary format. The
transport layer holds a `ProtocolCodec` instance injected at startup and never touches raw
bytes/strings itself beyond handing them to `codec.decode`/`codec.encode`.

Envelope shapes (JSON v1.0, see `03-websocket-events.md` for full catalog):

```ts
// client -> server
interface InboundEnvelope { id: string; event: string; data: unknown }
// server -> client, response to a request (correlated by id)
interface OutboundResponse { id: string; event: string; success: boolean; data?: unknown; error?: ErrorPayload }
// server -> client, unsolicited push (no id)
interface OutboundPush { event: string; data: unknown }
interface ErrorPayload { code: string; message: string; details?: unknown }
```

## 3. Handler registration (no switch statements)

Each WS event handler is a small class implementing a common interface. There is no self-
registration magic (decorators, module-load side effects, reflection) — every handler needs
constructor-injected domain services, which only the composition root (`src/main.ts`) can provide,
so `main.ts` is also the one place that calls `wsRegistry.register(new XHandler(...))` for every
handler, once, at boot:

```ts
interface EventHandler<TData = unknown, TResult = unknown> {
  event: string;                       // e.g. "message.send"
  handle(ctx: HandlerContext, data: TData): Promise<TResult> | TResult;
}
```

Input validation is not a declared schema object — each handler calls the small validators in
`src/shared/validation/` (see §6) directly as the first lines of `handle()`.

`src/application/websocket/handlers/**/*.ts` each export one handler class;
`src/application/websocket/registry.ts` only holds the `event -> handler` map and its `dispatch()`
method — `main.ts` is what actually populates it. The transport layer's WS message loop does
exactly one thing: `decode → registry.dispatch(ctx, envelope, logger) → encode`. No `switch`/
`if-else` chain ever inspects the event name outside the registry's map lookup.

HTTP follows the same shape with a `RouteHandler` interface and a `RouteRegistry`
(method + path pattern → handler), since the brief also asks for small modules over a monolithic
router.

## 4. Connection Manager

Tracks live WebSocket sockets and maps `userId -> Set<ConnectionId>` plus
`clientIp -> Set<ConnectionId>` for multi-device support and admission control, and stores
`ConnectionId -> { id, userId, clientIp, socket, createdAt, openedAt, lastActivityAt, lastHeartbeatSentAt }`.
There is deliberately no per-connection `subscribedRooms` set to maintain — a channel has no
subscription concept (see §13) and group/dm membership is just queried from
`conversation_memberships` fresh on each push, so there's no cache to keep in sync. Responsibilities:

- Atomically admit or reject authenticated sockets before the upgrade completes, enforcing
  configured per-user and per-IP connection caps without a race-prone `count -> later register`
  sequence.
- Register/unregister sockets on connect/close, with idempotent cleanup so server-driven close,
  client close, stale-connection reap, backpressure close, and graceful shutdown all release the
  same counters exactly once.
- Resolve "which sockets should receive this push" for a given room or user (fan-out for
  `message.new`, `presence.updated`, `typing.update`, etc., via the shared `roomAudienceUserIds`/
  `pushToRoomAudience` helpers). Fan-out target differs by room type (see §13): **channel** pushes
  go to every currently-connected socket (channels are public, there is no subscription list to
  consult); **group**/**dm** pushes go only to sockets whose `userId` has a `conversation_memberships` row for
  that room.
- Own the authoritative outbound send boundary: every production WS push/response/error flows
  through one `ConnectionManager` send path that checks `socket.bufferedAmount`, isolates send
  failures, and closes slow clients instead of letting memory grow without bound.
- Own presence transitions: mark `online` on first connection for a user, `offline` (+ `last_seen_at`)
  when their last connection closes; `idle`/`dnd` remain explicit client-driven states.
- Enforce one connection manager instance per process (in-memory only — acceptable since this is a
  single-process reference implementation; horizontal scaling would need a shared pub/sub, called
  out as a non-goal here).

## 5. Rate limiting and abuse control

Token-bucket per `(scope, category)`, in-memory `Map`. One `RateLimiter` instance per named
category, each with its own tuning, keyed by `${category}:${userId}` for authenticated actions or
`${category}:${clientIp}` pre-auth. The current server uses three layers:

- per-route HTTP limits for sensitive or write-heavy routes such as
  `auth.register/login/refresh/logout/change-password` and media uploads
- per-event WS limits for write-heavy business actions such as `message.send`,
  `reaction.toggle`, `group.create/addMember/removeMember/leave`, `message.edit/delete`, and
  `dm.open`
- a transport-level per-connection inbound WS limiter, plus a malformed-payload strike counter and
  maximum inbound frame size, to stop clients from bypassing application-level limits by flooding
  the socket with junk before dispatch

Cheap read-only events (`channel.list`, `profile.get`, `search.*`, ...) are not all individually
rate-limited, but they still pass through the transport-level WS abuse guard. Limit breaches return
the standard error envelope (`code: "RATE_LIMITED"`) or, for repeated protocol abuse, the server
closes the socket with a policy/protocol error instead of letting the connection stay hot
indefinitely. Separately from packet rate limiting, authenticated upgrades are also capped by
concurrent connection counts per user and peer IP.

## 6. Validation

Every handler declares an input schema (hand-rolled lightweight validators in
`src/shared/validation/`, no external dependency — matches the "no external framework" constraint).
Validation runs in the application layer before any domain service is called; domain services trust
their inputs are already well-formed (they still enforce *business* invariants like "group needs
≥3 members", which is not input validation, it's a domain rule).

## 7. Error handling

Domain and storage layers throw a small set of typed errors (`DomainError`, `NotFoundError`,
`ConflictError`, `ForbiddenError`, `ValidationError`). A single error-translation boundary in the
application layer (`toErrorPayload(err): ErrorPayload`) maps these to `{code, message, details}` and
nothing else escapes to the transport layer — an `try/catch` wrapper around every handler dispatch
guarantees no raw exception (including unexpected bugs — mapped to a generic `INTERNAL_ERROR` code
with the real error only in server logs) ever reaches a client.

## 8. Dependency injection

Minimal, explicit, constructor-based — no DI container/framework. A single composition root
(`src/main.ts`) constructs repositories → domain services → handlers → registries → transport, and
wires concrete implementations into interfaces. This keeps the domain layer testable (inject
in-memory fake repositories in unit tests) without adding a DI framework the brief doesn't ask for.

## 9. Logging

Structured JSON line logger (`src/shared/logging/logger.ts`), levels `debug|info|warn|error`,
fields: `timestamp, level, module, message, ...context`. Configurable minimum level via config.
No external logging library. Before a log line is serialized, the logger applies centralized
redaction for common credential/secret field names, bounds recursion depth, bounds visited
nodes/properties/array elements, truncates long strings, and survives circular references. The HTTP
transport emits one access log per request (`method, path, status, durationMs, clientIp`), the WS
upgrade path logs rejected origins/auth failures, and background jobs log failures without crashing
the process.

## 10. Configuration

`src/shared/config/config.ts` loads from environment variables (`Deno.env`) with typed defaults,
validated once at boot (fail fast on missing required values like `JWT_SECRET`). Security-sensitive
settings include environment mode, allowed origins, WS payload/abuse thresholds, upload size caps,
session/session-security TTLs, `PUBLIC_BASE_URL`, and mail-adapter selection. Production mode adds
stricter validation such as rejecting placeholder JWT secrets, rejecting a non-HTTPS
`PUBLIC_BASE_URL`, rejecting `MAIL_ADAPTER=development`, or rejecting wildcard/excessively broad
origin settings. No dynamic reconfiguration at runtime.

## 11. Health checks

Health probes are split:

- `GET /health/live` is the cheap liveness probe: no DB query, just "the process can answer HTTP".
- `GET /health/ready` is the readiness probe: it performs the SQLite `SELECT 1` check and returns
  503 on failure with a generic payload.
- `GET /health` remains as a compatibility alias for readiness so existing deployments do not break.

## 12. Concurrency & SQLite

Single `DB` connection (Deno's built-in `node:sqlite`, WAL mode, `foreign_keys = ON`) shared across
repositories; SQLite serializes writers internally so no separate connection pool is needed for a
reference implementation. Multi-statement operations run inside explicit `BEGIN/COMMIT`
transactions via a `withTransaction(db, fn)` helper (`src/storage/db.ts`), rolling back on any
thrown error. Nested calls use SQLite savepoints rather than opening independent transactions, so
one workflow can safely call another transactional workflow on the same connection without
silently escaping the outer unit of work.

## 13. Authorization model per room type

Confirmed with the project owner: **channels are public — there is no membership concept for
them.** Any authenticated user may read or post in any channel at any time; there is no
`channel.join`/`channel.leave` action (matches the frontend, which never had one either — its
channel list is a fixed, always-visible set). This changes the meaning of `conversation_memberships` and how
read-tracking works, see `02-database-schema.md` for the resulting schema:

- **`conversation_memberships`** now exists only to express real membership: **group** rows (owner/moderator/
  member, required for any group read/write) and **dm** rows (exactly 2 members, required for any
  DM read/write). Channels never get per-user `conversation_memberships` rows for ordinary access.
- **Optional channel moderators**: a channel *may* still have sparse `conversation_memberships` rows with
  `role='moderator'` for the small set of users granted elevated actions (e.g. deleting other
  users' messages) — this is additive, not a gate on basic read/write.
- **Unread counters / read receipts** can no longer live on `conversation_memberships.last_read_message_id`,
  since channels have no membership rows for regular users. This moved to its own table,
  `conversation_reads`, keyed by `(conversation_id, user_id)` for every room type, updated by `room.markRead`
  regardless of whether the room has membership semantics.
- **DM pair uniqueness** is enforced by the `direct_conversation_pairs` table, which stores one
  canonical user pair per DM conversation. `DmService.openDm()` looks up the canonical pair first,
  then creates the conversation, pair row, and memberships in one transaction so concurrent opens
  cannot create duplicate DM conversations for the same two users.
- `permissionService` (domain layer) branches on `room.type`: `channel` → always allow read/post
  for any authenticated user (only moderator-only actions consult `conversation_memberships`); `group`/`dm` →
  require a `conversation_memberships` row, deny otherwise (`FORBIDDEN`).

## 14. Lifecycle jobs

The server starts one session-cleanup pass after the database and repositories are ready, then
continues running periodic cleanup on the configured interval. The job deletes expired sessions and
revoked sessions older than the configured retention cutoff, logs failures, and is stopped during
graceful shutdown so tests and local runs do not leak timers.

WebSocket lifecycle ownership follows the same pattern: one shared lifecycle job sends
application-level `system.ping` pushes on the configured interval, watches `lastActivityAt`, closes
stale sockets after the configured idle timeout, and is started/stopped once at process lifetime
boundaries. There is no per-connection interval.

## 15. HTTP/WS security boundary

The transport layer is also where browser-facing policy is enforced:

- HTTP responses get a small fixed security-header set (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, and a CSP tuned to the
  shipped frontend's current dependencies)
- `Strict-Transport-Security` is emitted only when `APP_ENV=production` and
  `PUBLIC_HTTPS=true`; the server never trusts `X-Forwarded-Proto`/`Forwarded` to infer public TLS
- CORS is deny-by-default; same-origin always works, and any explicit cross-origin allowance is
  configured centrally
- WebSocket upgrades validate the browser `Origin` header against the same origin policy before the
  socket exists
- authenticated WebSocket upgrades are also subject to concurrent per-user/per-IP connection caps
- every outbound WS payload passes one backpressure-checked send boundary; a slow client is closed
  instead of receiving an unbounded server-side queue
- access-token `sid` claims are the trusted current-session identity used by session-management and
  password-change flows; clients do not pick the persisted `user_sessions` row via request JSON
- account-security emails (verification, password reset, email change) go through a typed mail
  service port, and every token-bearing link is built from trusted `PUBLIC_BASE_URL`, never request
  headers
- verified-email enforcement is centralized in `AccountPolicy.requireVerifiedEmail(userId)` and
  applied at the sensitive HTTP/WS boundaries, while unverified users retain only the narrow
  account-security actions needed to verify, recover, or revoke their own account
- ordinary file attachments are served with download-oriented headers, while avatars/covers remain
  embeddable images

This keeps the domain layer free of browser and transport policy concerns.
## Safety and moderation boundary

Safety data is persisted behind repository ports. `BlockPolicy` and `SanctionPolicy` are the centralized
server enforcement boundaries; HTTP/WS adapters never trust role or sanction claims from clients.
Moderation commands use HTTP, while `ConnectionManager` owns suspension-driven WebSocket closure.
`CaptchaVerifier` isolates provider behavior from auth routes. Security audit events form a separate
append-oriented ledger rather than relying on operational logs.

## Administration and runtime policy

Administration uses persisted roles `user < moderator < admin < owner` and one permission registry.
JWTs and client payloads carry no administration authority; every privileged operation reloads the
operator role from SQLite. `AdministrationService` owns user/channel/role operations and audit writes,
while `SettingsService` is the only reader/writer for supported mutable product policy.

Infrastructure paths, credentials, transport limits, and provider secrets remain environment-only.
Database settings contain only validated non-secret product policy and use per-setting versions for
compare-and-swap updates. Runtime policy is enforced at HTTP/WS mutation boundaries.
