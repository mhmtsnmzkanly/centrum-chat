# Moderation and User Safety

This phase adds backend-owned safety enforcement. Operator presentation is intentionally outside this
repository phase; the domain HTTP contract is documented in `11-moderation-api-contract.md`.

## Roles and authority

The current persisted authority is `users.system_role`, constrained to `user`, `moderator`, `admin`,
or `owner`; `app_role` remains only as migration-era data. Access tokens do not carry moderation
authority. Every moderation request reloads the actor from SQLite. Moderators may
inspect/assign/transition reports and apply or revoke temporary `message_mute` and
`interaction_restriction` sanctions. Only administrators may apply/revoke `account_suspension` and
query the security audit ledger; owners inherit those permissions. Administration role operations are
documented separately in `12-control-center-api-contract.md`.

## Blocks

Blocks are directional durable pairs. Either direction prevents opening a DM, sending into an existing
DM, or discovering the other party through global user search. Existing DM history and shared-group
membership/messages remain intact. Interactive profile lookup is denied when either direction is
blocked; historical message author summaries are unchanged. Shared-group messaging is not hidden or
removed. New DM/message notification creation is prevented because the authoritative operation is
rejected before persistence. Block creation and direct-message writes share SQLite transaction
serialization and recheck the block relationship inside the write transaction.

## Reports

Reports target exactly one `user`, `message`, or `attachment`. Reasons are `spam`, `harassment`,
`threats`, `impersonation`, `sexual_content`, `illegal_content`, `privacy`, or `other`; details are plain
text limited to 2,000 characters. Message/attachment targets must be accessible through normal
conversation authorization. Invalid and inaccessible targets share `NOT_FOUND`. One active
(`open`/`in_review`) report per reporter and target is enforced by partial unique indexes. Resolved or
dismissed targets may be reported again. Report creation never notifies the target.

Each report stores an immutable target identifier used for deduplication and audit continuity plus one
nullable live foreign key. Deleting the target clears the live reference but does not erase the report;
moderator context then reports that the target is unavailable.

Statuses are `open`, `in_review`, `resolved`, and `dismissed`. Allowed transitions are
`open -> in_review|dismissed` and `in_review -> resolved|dismissed|open`. Transitions include the
expected state in a compare-and-swap update. Assignment is claim-once for moderators; an assigned
report cannot be silently stolen. Administrators may explicitly reassign it.

## Sanctions

Active sanctions are selected using trusted server time; cleanup is not required for expiry.

- `message_mute`: blocks message send, reaction mutation, and ordinary message attachment upload.
- `interaction_restriction`: additionally blocks DM creation, group creation/member mutation, and user
  search. Avatar/cover and account-security operations remain available.
- `account_suspension`: blocks user-safety, moderation, and normal HTTP media mutation routes plus every
  WebSocket event except heartbeat. Account-security recovery/session routes remain available. Applying
  it closes existing sockets through `ConnectionManager`; reconnect upgrades are rejected.

Administrator sanctions may be temporary or indefinite. Moderator sanctions require an expiry and may
not exceed 30 days; moderators may sanction only normal users. Revocation is compare-and-swap and
records actor/reason.
Moderators cannot apply or revoke account suspensions.
Account suspensions must start immediately; future-dated suspension requests are rejected so accepted
suspensions always close current WebSocket connections at application time.

## Audit ledger

`security_audit_events` is append-oriented. Report context views, assignment, transitions, sanction
application/revocation, authorization failures, and CAPTCHA failures are recorded. Metadata accepts
only typed bounded scalar fields, is centrally redacted, and is capped at 4 KiB. Message bodies,
headers, credentials, and security tokens are never audit metadata. No application update/delete API
exists. SQLite/database operators can still alter rows; this is not cryptographically tamper-proof.

## CAPTCHA

Registration, login, and password-reset request consume `captchaToken`. `CaptchaVerifier` has
development, test, and Cloudflare Turnstile adapters. Turnstile Siteverify receives the configured
secret, expected hostname/action, and actual peer IP; forwarded headers are ignored. Registration and
login fail closed with `CAPTCHA_REQUIRED`. Password-reset request preserves its generic 200 response
but suppresses token issuance when verification fails. Existing rate limits remain active. Production
rejects the development adapter and requires Turnstile keys/hostname.
