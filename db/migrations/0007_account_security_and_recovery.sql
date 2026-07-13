-- Account security foundation: session metadata, verification state, and hashed
-- single-use tokens for email verification, password reset, and email change.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- Preserve existing pre-phase users by treating their already-established addresses as
-- verified at migration time; newly created users leave this column null until they
-- complete the verification flow.
UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL;

ALTER TABLE user_sessions ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0
  CHECK (remembered IN (0, 1));
ALTER TABLE user_sessions ADD COLUMN last_used_at TEXT;

UPDATE user_sessions
SET last_used_at = issued_at
WHERE last_used_at IS NULL;

CREATE TABLE email_verification_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_tokens_expires
  ON email_verification_tokens(expires_at);

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
