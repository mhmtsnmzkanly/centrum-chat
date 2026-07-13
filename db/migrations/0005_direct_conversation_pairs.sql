-- Canonical DM pair table. One row per DM conversation, with a canonical low/high user-id pair.

CREATE TABLE direct_conversation_pairs (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  user_low_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);
