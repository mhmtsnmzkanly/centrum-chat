# CentrumChat Server — HTTP API

HTTP is still deliberately narrower than the WS surface, but it now owns account security as well:
authentication, session management, verification/recovery flows, media upload, and health.
Everything else is WebSocket (see `03-websocket-events.md`). All responses use the same envelope:

```json
{ "success": true, "data": { "...": "..." } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

## Authentication

### `POST /api/auth/register`
Body: `{ username, email, password, displayName, rememberMe?, deviceLabel? }`
201 → `{ success: true, data: { user: Profile, accessToken, refreshToken } }`
Also creates a verification token and triggers verification mail delivery after commit.
Errors: `VALIDATION_ERROR` (bad format), `CONFLICT` (username or email taken).

### `POST /api/auth/login`
Body: `{ email, password, rememberMe?, deviceLabel? }`
200 → `{ success: true, data: { user: Profile, accessToken, refreshToken } }`
Errors: `UNAUTHORIZED` (bad credentials — generic message, no "which field was wrong" per
brief's "never trust client input" / avoid user enumeration).
Rate-limited by IP (`RateLimiter`, category `auth.login`).

### `POST /api/auth/refresh`
Body: `{ refreshToken }`
200 → `{ success: true, data: { accessToken, refreshToken } }` — rotates the refresh token
(old one is revoked, matches single-use refresh-token best practice) while preserving the existing
session row's `sid`, `deviceLabel`, `remembered`, and absolute expiry.
Errors: `UNAUTHORIZED` (expired/revoked/unknown token).

### `POST /api/auth/logout`
Header: `Authorization: Bearer <accessToken>`
Body: `{ refreshToken }`
200 → `{ success: true, data: {} }` — revokes the given refresh token. (Client-side WS connection
is expected to be closed by the client after this; server does not force-close on logout since a
user may have other active sessions/devices.)

### `POST /api/auth/change-password`
Header: `Authorization: Bearer <accessToken>`
Body: `{ currentPassword, newPassword }`
200 → `{ success: true, data: {} }` — updates password, preserves the current session, revokes all
other sessions, then triggers a password-changed notice after commit.
Errors: `UNAUTHORIZED` (bad current password), `VALIDATION_ERROR` (missing fields).

### `GET /api/auth/account`
Header: `Authorization: Bearer <accessToken>`
200 → `{ success: true, data: { email, emailVerifiedAt, pendingEmail } }`

### `GET /api/auth/sessions`
Header: `Authorization: Bearer <accessToken>`
200 → `{ success: true, data: { sessions: [{ id, deviceLabel, remembered, createdAt, lastUsedAt, expiresAt, current, ipAddress, userAgent, revokedAt }] } }`

`ipAddress` (resolved via the trusted-proxy policy, never a raw client header) and `userAgent`
(control-characters stripped, max 400 chars) are captured at login/register and refreshed on every
token rotation; both are `null` for sessions created before migration 0010. The list contains the
caller's unexpired sessions including recently revoked ones as client history: `revokedAt` is
`null` for active sessions and set for revoked ones (revoked rows disappear once the session
cleanup job purges them). No external geolocation service is involved.

### `DELETE /api/auth/sessions/:sessionId`
Header: `Authorization: Bearer <accessToken>`
200 → `{ success: true, data: { revokedCurrent } }`
Revokes only sessions owned by the caller. Revoking the current session immediately revokes its
refresh token; the current short-lived access token may still validate until expiry.

### `DELETE /api/auth/sessions/others`
Header: `Authorization: Bearer <accessToken>`
200 → `{ success: true, data: { revokedCount } }`

### `POST /api/auth/verify-email/resend`
Header: `Authorization: Bearer <accessToken>`
200 → `{ success: true, data: { alreadyVerified, sent } }`

### `POST /api/auth/verify-email/complete`
Body: `{ token }`
200 → `{ success: true, data: { verified: true } }`
Consumes the verification token atomically; exactly one concurrent completion may succeed.

### `POST /api/auth/password-reset/request`
Body: `{ email }`
200 → `{ success: true, data: { message } }`
Enumeration-resistant public response: the body is the same whether the account exists or not.

### `POST /api/auth/password-reset/complete`
Body: `{ token, newPassword }`
200 → `{ success: true, data: {} }`
Consumes the reset token atomically, updates the password, revokes all sessions, invalidates other
active reset tokens, and sends a password-changed notice after commit. Does **not** auto-login.

### `POST /api/auth/email-change/start`
Header: `Authorization: Bearer <accessToken>`
Body: `{ currentPassword, newEmail }`
200 → `{ success: true, data: {} }`
Creates a pending email-change token and mails the confirmation link to `newEmail`.

### `POST /api/auth/email-change/complete`
Header: `Authorization: Bearer <accessToken>`
Body: `{ token }`
200 → `{ success: true, data: { email, emailVerifiedAt } }`
Completion is authenticated and tied to the initiating user; the token cannot be consumed by a
different authenticated account.

Access JWT: short-lived (15 min), payload `{ sub: userId, username, sid, iat, exp }`, signed HS256
with `JWT_SECRET` from config. Refresh tokens are opaque random values, stored hashed
(`user_sessions.refresh_token_hash`), rotated on each use, and scoped to a user-session row with
either `SESSION_DEFAULT_TTL_MS` or `SESSION_REMEMBERED_TTL_MS` absolute expiry.

## Media Upload

### `POST /api/media/upload`
Header: `Authorization: Bearer <accessToken>`, `Content-Type: multipart/form-data`
Form field: `file` (single file, max size from config e.g. 25MB)
201 → `{ success: true, data: { attachmentId, fileName, mimeType, sizeBytes, url } }`
The returned `attachmentId` is passed as `message.send`'s `attachmentId` field over WS to associate
the upload with a message. Uploads not attached to a message within e.g. 1 hour are garbage
collected (orphan cleanup job). Files are stored on disk under a configurable `MEDIA_ROOT`,
addressed by UUID filename; `storage_path` in the DB is relative to `MEDIA_ROOT`, never absolute.
Unverified accounts receive `EMAIL_VERIFICATION_REQUIRED`.
Errors: `VALIDATION_ERROR` (missing file, size/type not allowed).

### `POST /api/media/avatar`
Header: `Authorization: Bearer <accessToken>`, `Content-Type: multipart/form-data`
Form field: `file` (image only, max size e.g. 5MB)
200 → `{ success: true, data: { avatarUrl } }` — also updates `users.avatar_url` for the caller.
Same disk-storage rule as above; old avatar file is deleted once the new one is persisted.
Unverified accounts receive `EMAIL_VERIFICATION_REQUIRED`.

### `GET /media/:id`
Public (attachment/avatar/cover retrieval) or auth-gated depending on room privacy — reference
implementation serves attachments behind the same auth check as `message.history` for the owning
room (caller must be a member); avatars and covers are served unauthenticated since they're meant to be
publicly renderable. For gated attachments the access token is taken from the `Authorization: Bearer`
header, or — because `<img>`/`<a download>` tags cannot send headers — from a `?token=<accessJwt>`
query parameter as a fallback (the same mechanism the WebSocket upgrade uses). Streams the file from
disk with correct `Content-Type`/`Content-Length`; never reads the whole file into memory for large
attachments (`Deno.open` + stream response body).

### `POST /api/media/cover`
Header: `Authorization: Bearer <accessToken>`, `Content-Type: multipart/form-data`
Form field: `file` (image only, max size e.g. 5MB)
200 → `{ success: true, data: { coverUrl } }` — also updates `users.cover_url` for the caller.
Same disk-storage rule as avatar; old cover file is deleted once the new one is persisted.
Unverified accounts receive `EMAIL_VERIFICATION_REQUIRED`.

## Health

### `GET /health/live`
No auth. Cheap liveness probe. 200 → `{ success: true, data: { status: "ok" } }`.
This route does **not** touch SQLite.

### `GET /health/ready`
No auth. Readiness probe. 200 → `{ success: true, data: { status: "ok" } }` when the SQLite
readiness check (`SELECT 1`) succeeds. Returns 503 with a generic
`{ success: false, error: { code: "UNAVAILABLE", message: "Service not ready." } }`-style payload
when the runtime dependency check fails; internal SQL details stay in server logs only.

### `GET /health`
Compatibility alias for `/health/ready`, preserved so existing deployments and tests do not break.
## Safety and moderation

Normal-user block/report and operator moderation routes are specified in
`11-moderation-api-contract.md`. Registration, login, and password-reset request accept
`captchaToken`; public configuration exposes only the provider/site key, never the secret.

## Administration API

The authoritative Control Center backend contract is `12-control-center-api-contract.md`.
Administration commands use HTTP only and accept no password hashes, session hashes, secrets,
arbitrary setting keys, or client role claims.

## Control Center static client

`GET /control-center`, `/control-center/`, and `/control-center/index.html` serve the integrated
Control Center shell. Its allow-listed JavaScript and CSS modules are available below
`/control-center/`; test files, fixture modules, Markdown handoff files, and unknown paths are not
served. The static client uses the same local/session credential policy as the chat client and gets
all operator identity, permission, and area data from `GET /api/control-center/me`.
