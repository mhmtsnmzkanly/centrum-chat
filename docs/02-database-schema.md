# CentrumChat Server — Database Schema

SQLite. WAL mode (`PRAGMA journal_mode = WAL`). Foreign keys enforced
(`PRAGMA foreign_keys = ON`, set on every connection open). All primary keys are `TEXT` UUIDv4
generated in the storage layer (`crypto.randomUUID()`), except join tables which use composite
keys. All timestamps are `TEXT` ISO-8601 UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` default or
app-supplied). Booleans are `INTEGER` 0/1 (SQLite has no native boolean).

Design note: channels, groups and DMs are modeled as one `conversations` table with a `type` discriminator
rather than three separate tables — they share >90% of their shape (membership, messages,
permissions) and the frontend's own domain model treats them uniformly as "destinations". This
avoids three near-duplicate schemas and three near-duplicate repositories.

## Migrations

Plain numbered SQL files in `db/migrations/0001_init.sql`, `0002_*.sql`, ... A `schema_migrations`
table tracks applied versions; the migration runner applies pending files in order inside a
transaction at server boot. Schema is never generated dynamically at runtime.

```sql
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

## Core tables

```sql
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,          -- lowercase [a-z0-9_]
  display_name      TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  onboarding_preferences_completed_at TEXT,       -- NULL for new unfinished accounts
  password_hash     TEXT NOT NULL,
  bio               TEXT NOT NULL DEFAULT '',
  avatar_seed       TEXT,
  avatar_url        TEXT,                          -- uploaded custom avatar, overrides seed
  cover_index       INTEGER NOT NULL DEFAULT 0,
  cover_url         TEXT,                          -- uploaded custom cover
  name_color        TEXT,                          -- #RRGGBB validated at application boundary
  status            TEXT NOT NULL DEFAULT 'offline'
                       CHECK (status IN ('online','idle','dnd','offline')),
  last_seen_at      TEXT,
  is_premium        INTEGER NOT NULL DEFAULT 0,
  messages_sent     INTEGER NOT NULL DEFAULT 0,
  reactions_added   INTEGER NOT NULL DEFAULT 0,
  replies_made      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE user_preferences (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sound_enabled          INTEGER NOT NULL DEFAULT 1,
  desktop_notifications  INTEGER NOT NULL DEFAULT 0,
  dm_privacy             TEXT NOT NULL DEFAULT 'everyone'
                            CHECK (dm_privacy IN ('everyone','group_members','no_one')),
  group_privacy          TEXT NOT NULL DEFAULT 'everyone'
                            CHECK (group_privacy IN ('everyone','dm_contacts','no_one')),
  theme                  TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light'))
);

CREATE TABLE user_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash    TEXT NOT NULL UNIQUE,               -- sha256 of the raw refresh token
  device_label  TEXT,
  remembered    INTEGER NOT NULL DEFAULT 0 CHECK (remembered IN (0, 1)),
  issued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  TEXT,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE email_verification_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_tokens_expires ON email_verification_tokens(expires_at);

CREATE TABLE password_reset_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

CREATE TABLE email_change_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email     TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_email_change_tokens_user ON email_change_tokens(user_id);
CREATE INDEX idx_email_change_tokens_expires ON email_change_tokens(expires_at);

CREATE TABLE direct_conversation_pairs (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  user_low_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('channel','group','dm')),
  slug        TEXT,                                  -- channels only, e.g. 'general'
  name        TEXT,                                   -- null for dm (derived from members)
  topic       TEXT,
  owner_id    TEXT REFERENCES users(id),
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (type, slug)
);

-- Membership rows exist ONLY for 'group' and 'dm' conversations, where they gate read/write access.
-- Channels are public (see architecture doc §13): any authenticated user may read/post in any
-- channel without a row here. A channel MAY still have sparse rows with role='moderator' to grant
-- elevated actions (e.g. deleting others' messages) to specific users, without those rows being a
-- precondition for ordinary access.
CREATE TABLE conversation_memberships (
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner','moderator','member')),
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_memberships_user ON conversation_memberships(user_id);

-- Read-tracking is decoupled from membership since channels have no per-user membership rows for
-- ordinary users but still need per-user unread counters. Applies to all room types.
CREATE TABLE conversation_reads (
  conversation_id               TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id  TEXT REFERENCES messages(id),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_reads_user ON conversation_reads(user_id);

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  conversation_id       TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id     TEXT REFERENCES users(id),           -- null for system messages
  content       TEXT NOT NULL,
  reply_to_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
  is_system     INTEGER NOT NULL DEFAULT 0,
  edited_at     TEXT,
  deleted_at    TEXT,                                 -- soft delete
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_id);

CREATE TABLE reactions (
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX idx_reactions_message ON reactions(message_id);

CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  message_id     TEXT REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  storage_path   TEXT NOT NULL,                       -- relative path on disk, never file bytes in DB
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind           TEXT NOT NULL DEFAULT 'attachment'    -- 'attachment' | 'avatar' | 'cover', added in migration 0003
);
CREATE INDEX idx_attachments_message ON attachments(message_id);
CREATE INDEX idx_attachments_uploader ON attachments(uploader_id);
```

Session/security-token notes:

- `user_sessions.id` is the stable session identifier carried in access-token `sid` claims.
  Session-management APIs expose only safe metadata (`device_label`, `remembered`, timestamps,
  expiry, `current`), never `refresh_token_hash`.
- `remembered` records the remember-me policy chosen at login/registration. Refresh rotation updates
  the existing row in place, preserving `expires_at` as an absolute session-family expiry.
- verification, password-reset, and email-change tables store only token hashes. Raw tokens exist
  only during `generate -> hash -> persist -> deliver mail`.

`kind` distinguishes a message attachment (`message_id` eventually set, auth-gated the
same as the owning room) from an avatar or cover upload (`message_id` always null, served
unauthenticated by `GET /media/:id` since an `<img>` tag never sends an `Authorization`
header) — both share this one table and the same `storage_path` convention. `uploader_id`
captures who uploaded the file so the server can prove ownership before allowing a pending
upload to be attached to a message or fetched before it is conversation-bound.

```sql

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                         -- 'mention' | 'dm' | 'group_invite' | 'reaction'
  conversation_id      TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
  payload_json TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);
```

Note: `conversation_reads.last_read_message_id` references `messages`, so table creation order in the
migration file is: `users` → `conversations` → `messages` → `conversation_memberships` → `conversation_reads` → `reactions` →
`attachments` → `notifications` → `user_preferences` → `user_sessions`.

## Seed data

The default public channels the frontend hardcodes (`general`, `programming`, `technology`,
`gaming`) are inserted as ordinary `conversations` rows (`type='channel', is_public=1`) by a seed step run
once after migrations (either the last migration file or a dedicated `db/seed.sql` run only when
the table is empty) — not hardcoded into application logic. Creating further channels later only
means inserting more `conversations` rows; no code path treats the channel list as fixed.

## Derived data (not stored, computed at query time)

- **Unread counters**: `COUNT(messages) WHERE conversation_id = ? AND rowid > (SELECT rowid FROM messages WHERE id = conversation_reads.last_read_message_id) AND deleted_at IS NULL`. Compared by `rowid`, not `created_at`: two messages can land in the same created_at millisecond under rapid sends, which would silently break a `>` comparison on the timestamp alone — `rowid` is always strictly increasing by insertion order. `conversation_reads` rows are upserted lazily on first `room.markRead` for a given `(conversation_id, user_id)` — including for channels, which have no `conversation_memberships` row at all.
- **Presence**: `users.status` + `users.last_seen_at` are the persisted source of truth; the in-memory Connection Manager (see architecture doc §4) drives transitions but the DB row is what's returned to newly-connecting clients.
- **DM room resolution**: a DM room is looked up by the *pair* of member user_ids via `direct_conversation_pairs`; `conversations.slug` is unused for type='dm'. The pair table stores one canonical low/high user-id pair per DM conversation, and the database unique constraint is the final authority against duplicate pairs.
- **Channel read/write authorization**: no query against `conversation_memberships` at all — `permissionService` allows any authenticated user for `room.type='channel'` (see architecture doc §13).
- **Pending upload ownership**: an unattached `attachments` row remains readable/attachable only by
  its `uploader_id` until `message_id` is set. Once attached, access follows conversation/message
  authorization instead.

## Security migration notes

- `0005_direct_conversation_pairs.sql` added canonical DM uniqueness.
- `0006_attachment_ownership_and_security_foundation.sql` adds `attachments.uploader_id` and
  backfills it from existing message authors and avatar/cover URL ownership where possible.
- Historical migrations remain unchanged; only the live schema gains the new ownership column and
  index.

## Data-model → frontend field mapping (reference only, no code depends on this)

| Frontend field (from `app.js`) | Server column |
|---|---|
| `user.avatarSeed` / `customAvatar` | `users.avatar_seed` / `users.avatar_url` |
| `user.coverIndex` / `customCover` | `users.cover_index` / `users.cover_url` |
| `user.nameColor` | `users.name_color` |
| `user.joinedDate` (pre-formatted string) | derived from `users.created_at` at the application layer, not stored pre-formatted |
| `message.reactions: {emoji: [usernames]}` | `reactions` rows, aggregated at query time |
| `message.edited` | `messages.edited_at IS NOT NULL` |
| `message.system` | `messages.is_system` |
| `group.members` | `conversation_memberships` rows where `conversations.type='group'` |
## Safety and moderation tables

Migration 0008 adds `users.app_role`, `user_blocks`, constrained `reports`, `user_sanctions`, and
`security_audit_events`. Directional block pairs are unique and cannot self-reference. Reports enforce
exactly one live target foreign key and partial uniqueness for active reporter/target pairs. The immutable
`target_reference_id` retains the reported identifier if a live target is later deleted; `ON DELETE SET
NULL` avoids deleting the moderation record. Sanction type and report workflow values are
CHECK-constrained. CAPTCHA responses are never persisted.

## Administration schema

Migration 0009 adds authoritative `users.system_role` (`user`, `moderator`, `admin`, `owner`),
`must_reset_password`, `account_disabled_at`, and `admin_version`. The earlier `app_role` column
is retained only for additive-migration compatibility and is no longer authoritative.

Channels gain `description`, `sort_order`, `lifecycle_state`, `admin_version`, and `updated_at`.
Administration mutates only `conversations.type='channel'`. `system_settings` stores a fixed allow-list
of non-secret JSON values with type, version, updater, and timestamp.
