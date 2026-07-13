-- Durable user safety, moderation workflow, sanctions, and append-oriented audit ledger.

ALTER TABLE users ADD COLUMN app_role TEXT NOT NULL DEFAULT 'user'
  CHECK (app_role IN ('user', 'moderator', 'admin'));

CREATE TABLE user_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_user_id, blocker_user_id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'message', 'attachment')),
  target_reference_id TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  target_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'spam', 'harassment', 'threats', 'impersonation', 'sexual_content',
    'illegal_content', 'privacy', 'other'
  )),
  details TEXT CHECK (details IS NULL OR length(details) <= 2000),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  assigned_moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT,
  CHECK (
    (target_type = 'user' AND target_message_id IS NULL AND target_attachment_id IS NULL)
    OR
    (target_type = 'message' AND target_user_id IS NULL AND target_attachment_id IS NULL)
    OR
    (target_type = 'attachment' AND target_user_id IS NULL AND target_message_id IS NULL)
  )
);
CREATE INDEX idx_reports_queue ON reports(status, created_at DESC, id DESC);
CREATE INDEX idx_reports_assignee ON reports(assigned_moderator_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_reports_active_user_unique
  ON reports(reporter_user_id, target_reference_id)
  WHERE target_type = 'user' AND status IN ('open', 'in_review');
CREATE UNIQUE INDEX idx_reports_active_message_unique
  ON reports(reporter_user_id, target_reference_id)
  WHERE target_type = 'message' AND status IN ('open', 'in_review');
CREATE UNIQUE INDEX idx_reports_active_attachment_unique
  ON reports(reporter_user_id, target_reference_id)
  WHERE target_type = 'attachment' AND status IN ('open', 'in_review');

-- Preserve reports after target deletion, but require every newly inserted report to
-- reference exactly one existing target and bind its immutable reference to that row.
CREATE TRIGGER reports_validate_target_insert
BEFORE INSERT ON reports
WHEN NOT (
  (NEW.target_type = 'user' AND NEW.target_user_id IS NOT NULL
    AND NEW.target_reference_id = NEW.target_user_id)
  OR
  (NEW.target_type = 'message' AND NEW.target_message_id IS NOT NULL
    AND NEW.target_reference_id = NEW.target_message_id)
  OR
  (NEW.target_type = 'attachment' AND NEW.target_attachment_id IS NOT NULL
    AND NEW.target_reference_id = NEW.target_attachment_id)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid report target');
END;

CREATE TABLE user_sanctions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sanction_type TEXT NOT NULL CHECK (
    sanction_type IN ('message_mute', 'interaction_restriction', 'account_suspension')
  ),
  reason_code TEXT NOT NULL,
  moderator_note TEXT CHECK (moderator_note IS NULL OR length(moderator_note) <= 2000),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id),
  revoke_reason TEXT CHECK (revoke_reason IS NULL OR length(revoke_reason) <= 500),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);
CREATE INDEX idx_user_sanctions_active
  ON user_sanctions(user_id, revoked_at, starts_at, expires_at);
CREATE INDEX idx_user_sanctions_created ON user_sanctions(created_at DESC, id DESC);

CREATE TABLE security_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'moderator', 'admin', 'system')),
  action_code TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  metadata_json TEXT CHECK (metadata_json IS NULL OR length(metadata_json) <= 4096),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_security_audit_created
  ON security_audit_events(created_at DESC, id DESC);
CREATE INDEX idx_security_audit_action
  ON security_audit_events(action_code, created_at DESC, id DESC);
CREATE INDEX idx_security_audit_actor
  ON security_audit_events(actor_user_id, created_at DESC, id DESC);
