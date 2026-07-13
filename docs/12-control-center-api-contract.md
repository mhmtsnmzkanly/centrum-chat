# Control Center Backend API Contract

All routes use the standard `{ success, data|error }` envelope and bearer authentication. Authority is
always loaded from persisted `users.system_role`; client role/capability fields are ignored. Cursor
lists use stable descending `(created_at,id)` order, default limit 25, maximum 100. Stale expected
versions return a conflict error.

## Roles and permissions

Roles are `user`, `moderator`, `admin`, `owner`; permissions inherit by hierarchy.

Migration 0009 promotes at most one existing admin (oldest by creation/id) when upgrading a database
without an owner. A fresh database uses the explicit `BOOTSTRAP_OWNER_EMAIL` startup CAS: first create
the account, then restart with the normalized matching email while no owner exists. The final-owner
database triggers and application hierarchy prevent later removal; the bootstrap variable should be
removed after success.

- Moderator: `moderation.reports.view`, `moderation.reports.assign`,
  `moderation.reports.transition`, `moderation.context.view`,
  `moderation.sanctions.message_mute`, `moderation.sanctions.interaction_restriction`,
  `moderation.sanctions.revoke`.
- Admin adds: `moderation.sanctions.account_suspension`, `admin.users.view`,
  `admin.users.edit`, `admin.users.sessions.revoke`, `admin.users.force_password_reset`,
  `admin.users.reset_media`, `admin.channels.view`, `admin.channels.create`,
  `admin.channels.update`, `admin.channels.archive`, `admin.channels.restore`,
  `admin.roles.view`, `admin.roles.assign_moderator`, `admin.roles.revoke_moderator`,
  `admin.settings.view`, `admin.settings.update`, `admin.feature_flags.update`,
  `admin.registration_policy.update`, `admin.audit.view`.
- Owner adds: `owner.admins.assign`, `owner.admins.revoke`, `owner.ownership.transfer`,
  `owner.security_settings.update`.

## Operator

`GET /api/control-center/me` returns `{ user:{id,username,displayName,avatarUrl}, role, permissions,
areas:{moderation,administration,owner} }`. It exposes no credentials or hashes.

## Users and roles

- `GET /api/admin/users?search=&role=&verified=&suspended=&disabled=&cursor=&limit=`.
- `GET /api/admin/users/:userId`.
- `PATCH /api/admin/users/:userId` body
  `{ expectedVersion, displayName?, bio?, disabled? }`.
- `POST /api/admin/users/:userId/revoke-sessions`.
- `POST /api/admin/users/:userId/force-password-reset`.
- `POST /api/admin/users/:userId/reset-avatar` and `/reset-cover`.
- `POST /api/admin/users/:userId/roles` body `{ expectedRole, role }`.
- `DELETE /api/admin/users/:userId/roles/:role` body `{ expectedRole }`; demotes to `user`.
- `POST /api/owner/transfer` body
  `{ targetUserId, expectedCurrentOwnerRole, expectedTargetRole }`.

User DTOs never contain password/session/token hashes. Safe edits cannot change IDs, emails,
passwords, roles, tokens, or provider fields. Forced reset revokes all refresh sessions and blocks
normal application mutations until password-reset completion clears the flag. Stateless access tokens
remain cryptographically valid until expiry, but runtime account-state checks still apply.
Avatar/cover resets clear the profile reference and remove the corresponding attachment record and
disk file when the prior value is a server-owned `/media/:id` asset.

## Channels

- `GET /api/admin/channels?state=active|archived&cursor=&limit=`.
- `POST /api/admin/channels` body
  `{ slug, name, description?, sortOrder? }`.
- `PATCH /api/admin/channels/:channelId` body
  `{ expectedVersion, name?, description?, sortOrder? }`.
- `POST /api/admin/channels/:channelId/archive` or `/restore` body `{ expectedVersion }`.

Only `type='channel'` is mutable. Channels retain the existing public-access model, so unsupported
private-channel visibility is not exposed as mutable policy. Hard delete is not exposed. The active
default channel cannot be archived. Other archived channels are hidden from normal discovery and
reject new mutations while remaining readable for history.

## Settings

`GET /api/admin/settings` returns descriptors `{ key,type,value,defaultValue,version,permission,
restartRequired:false }`. `PATCH /api/admin/settings` accepts `{ key,expectedVersion,value }`.

Supported keys: `registration_enabled`, `email_verification_required`, `maintenance_mode`,
`max_message_length`, `max_group_members`, `max_upload_size_bytes`,
`max_avatar_size_bytes`, `max_cover_size_bytes`, `allow_group_creation`, `allow_new_dm`,
`default_channel_id`. Arbitrary and secret keys are rejected. Infrastructure/secrets remain
environment-only. Database policy overrides bootstrap defaults; upload settings are additionally
capped by environment infrastructure maxima. `email_verification_required` requires owner authority.

Maintenance blocks normal application mutations for every role while preserving reads, heartbeat,
health, account recovery, and permission-protected moderation/administration HTTP operations.
Registration-disabled rejects before CAPTCHA/password work. Default
channels must exist, be active, and have type `channel`.

`max_message_length` applies to both send and edit. `max_group_members` applies to creation and
later member additions. Upload limits apply at multipart extraction and cannot exceed environment
infrastructure maxima. `allow_group_creation` and `allow_new_dm` gate only creation; existing groups,
DM history, and read access remain available.

## Audit and stable errors

New actions include `admin.user.updated`, `admin.user.sessions_revoked`,
`admin.user.password_reset_forced`, `admin.user.avatar_reset`, `admin.user.cover_reset`,
`admin.channel.created`, `admin.channel.updated`, `admin.channel.archived`,
`admin.channel.restored`, `admin.setting.updated`, `admin.role.assigned`,
`admin.registration_policy.updated`, `admin.maintenance_mode.updated`, `admin.role.revoked`, and
`owner.transferred`.

Stable errors: `PERMISSION_DENIED`, `OWNER_REQUIRED`, `FINAL_OWNER_PROTECTED`,
`ROLE_HIERARCHY_VIOLATION`, `ROLE_CONFLICT`, `USER_NOT_FOUND`,
`USER_UPDATE_CONFLICT`, `FORCE_PASSWORD_RESET_REQUIRED`, `ACCOUNT_DISABLED`,
`CHANNEL_NOT_FOUND`, `CHANNEL_ALREADY_ARCHIVED`, `CHANNEL_NOT_ARCHIVED`,
`CHANNEL_UPDATE_CONFLICT`, `SETTING_NOT_SUPPORTED`, `SETTING_VALIDATION_FAILED`,
`SETTING_UPDATE_CONFLICT`, `REGISTRATION_DISABLED`, and `MAINTENANCE_MODE`.

## Integrated browser client

The production client is served at `/control-center` and calls only the routes documented above and
in `11-moderation-api-contract.md`. It treats the operator response's `permissions` and `areas` as
presentation data and never derives authority from a displayed role. A user operator is denied;
moderator, administration, and owner areas are shown only after the operator response resolves.

Persistent credentials win if both browser stores contain credentials, and the conflicting session
entry is removed. Authentication loss clears both stores and all sensitive Control Center state.
Permission loss clears sensitive state and reloads operator authority. Destructive mutations are not
automatically retried after refresh.

User, channel, report, role, and setting conflicts retain local input, fetch authoritative state,
and require an explicit resubmission. Settings are updated one descriptor at a time with
`{ key, expectedVersion, value }`; user and channel updates send only changed allow-listed fields.
No global sanctions list, channel hard delete, private-channel controls, or arbitrary settings are
implemented.
