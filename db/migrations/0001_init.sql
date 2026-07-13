-- Initial schema. See docs/02-database-schema.md for design rationale.

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  bio               TEXT NOT NULL DEFAULT '',
  avatar_seed       TEXT,
  avatar_url        TEXT,
  cover_index       INTEGER NOT NULL DEFAULT 0,
  cover_url         TEXT,
  name_color        TEXT,
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

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('channel','group','dm')),
  slug        TEXT,
  name        TEXT,
  topic       TEXT,
  owner_id    TEXT REFERENCES users(id),
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (type, slug)
);

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id     TEXT REFERENCES users(id),
  content       TEXT NOT NULL,
  reply_to_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
  is_system     INTEGER NOT NULL DEFAULT 0,
  edited_at     TEXT,
  deleted_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_room_created ON messages(room_id, created_at);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_id);

-- Membership rows exist ONLY for 'group' and 'dm' rooms, where they gate read/write access.
-- Channels are public (see docs/01-architecture.md §13): any authenticated user may read/post in
-- any channel without a row here. A channel MAY still have sparse rows with role='moderator' to
-- grant elevated actions to specific users, without those rows being a precondition for access.
CREATE TABLE room_members (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner','moderator','member')),
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

-- Read-tracking is decoupled from membership since channels have no per-user membership rows for
-- ordinary users but still need per-user unread counters. Applies to all room types.
CREATE TABLE room_reads (
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id  TEXT REFERENCES messages(id),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_reads_user ON room_reads(user_id);

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
  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  storage_path   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_attachments_message ON attachments(message_id);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  room_id      TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
  payload_json TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);

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

CREATE TABLE refresh_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  device_label  TEXT,
  issued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
