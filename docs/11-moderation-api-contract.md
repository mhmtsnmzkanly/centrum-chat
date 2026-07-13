# Moderation API Contract

All responses use the standard `{ success, data|error }` envelope. Operator authority is loaded
from persisted `users.system_role`; client role fields are ignored. Cursor lists use opaque row IDs,
descending `(created_at,id)` order, default limit 25, and maximum 100.

## Stable values

- Roles: `user`, `moderator`, `admin`, `owner`.
- Targets: `user`, `message`, `attachment`.
- Reasons: `spam`, `harassment`, `threats`, `impersonation`, `sexual_content`, `illegal_content`,
  `privacy`, `other`.
- Report statuses: `open`, `in_review`, `resolved`, `dismissed`.
- Sanctions: `message_mute`, `interaction_restriction`, `account_suspension`.
- Policy errors: `BLOCKED_INTERACTION`, `MESSAGE_MUTED`, `INTERACTION_RESTRICTED`,
  `ACCOUNT_SUSPENDED`, `CAPTCHA_REQUIRED`.

## Normal-user routes

- `PUT /api/safety/blocks/:userId` -> `{ blocked: true }`.
- `DELETE /api/safety/blocks/:userId` -> `{ blocked: false }`.
- `GET /api/safety/blocks?cursor=&limit=` -> `{ items: BlockedUserDto[], nextCursor }`.
- `POST /api/safety/reports` body
  `{ targetType, targetId, reasonCode, details? }` -> `{ report: ReportReceiptDto }`.

`ReportReceiptDto` contains only `id`, `targetType`, `reasonCode`, `status`, and `createdAt`; it never
contains reporter information.

## Moderator routes

- `GET /api/moderation/reports?status=&targetType=&assignedToMe=&cursor=&limit=`.
- `GET /api/moderation/reports/:reportId`.
- `GET /api/moderation/reports/:reportId/context?before=&after=`; each bound is 0..20 and total
  message context is capped at 41 including the reported message.
- `POST /api/moderation/reports/:reportId/assign` body `{ expectedAssigneeId?: string|null,
  moderatorId?: string }`. Moderators may claim unassigned reports for themselves. Admins may select a
  moderator/admin assignee.
- `POST /api/moderation/reports/:reportId/status` body `{ expectedStatus, nextStatus }`.
- `GET /api/moderation/users/:userId/sanctions?activeOnly=true|false&cursor=&limit=`.
- `POST /api/moderation/users/:userId/sanctions` body
  `{ type, reasonCode, moderatorNote?, startsAt?, expiresAt? }`.
- `POST /api/moderation/sanctions/:sanctionId/revoke` body `{ reason? }`.

Report DTOs include target IDs, reporter ID, assignment, timestamps, reason/details, and current
status. Context DTOs include only the reported target, bounded adjacent message summaries, reported
user summary, attachment metadata without storage paths, and active sanction summaries. They exclude
password/session/token/mail fields and unrelated conversations.

`account_suspension` requires administrator authority and an immediate start; future `startsAt` values
are rejected. Moderator-created lesser sanctions require an expiry no more than 30 days after start.

## Administrator route

- `GET /api/admin/audit-events?actionCode=&actorUserId=&targetType=&targetId=&cursor=&limit=` ->
  `{ items: AuditEventDto[], nextCursor }`.

Audit DTO fields are `id`, `actorUserId`, `actorType`, `actionCode`, `targetType`, `targetId`, `outcome`,
bounded `metadata`, and `createdAt`. Only operators with `admin.audit.view` (admin and owner) may
query this endpoint; moderators do not receive broad audit access.

Moderation commands return `FORBIDDEN` for insufficient persisted authority, `CONFLICT` for stale
expected-state/assignment operations, `NOT_FOUND` for inaccessible/missing targets, and the standard
validation/rate-limit errors. No moderator WebSocket command API exists. Applying suspension may emit
generic connection closure; no moderator identity or note is sent to the target.

The integrated Control Center uses these exact routes. It does not expose unassignment because the
service implements claim-once assignment for moderators and explicit reassignment by administrators.
There is no global sanctions endpoint; sanctions are loaded in user/report investigation context.
