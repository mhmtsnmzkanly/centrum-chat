-- Four-role administration, optimistic versions, channel lifecycle, and fixed non-secret settings.

ALTER TABLE users ADD COLUMN system_role TEXT NOT NULL DEFAULT 'user'
  CHECK (system_role IN ('user', 'moderator', 'admin', 'owner'));
UPDATE users SET system_role = app_role;
UPDATE users SET system_role = 'owner'
WHERE id = (
  SELECT id FROM users WHERE system_role = 'admin' ORDER BY created_at, id LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM users WHERE system_role = 'owner');
ALTER TABLE users ADD COLUMN must_reset_password INTEGER NOT NULL DEFAULT 0
  CHECK (must_reset_password IN (0, 1));
ALTER TABLE users ADD COLUMN account_disabled_at TEXT;
ALTER TABLE users ADD COLUMN admin_version INTEGER NOT NULL DEFAULT 1
  CHECK (admin_version > 0);
CREATE INDEX idx_users_system_role ON users(system_role, created_at DESC, id DESC);

CREATE TRIGGER users_protect_final_owner_update
BEFORE UPDATE OF system_role ON users
WHEN OLD.system_role = 'owner' AND NEW.system_role <> 'owner'
  AND (SELECT COUNT(*) FROM users WHERE system_role='owner') <= 1
BEGIN
  SELECT RAISE(ABORT, 'final owner protected');
END;
CREATE TRIGGER users_protect_final_owner_delete
BEFORE DELETE ON users
WHEN OLD.system_role = 'owner'
  AND (SELECT COUNT(*) FROM users WHERE system_role='owner') <= 1
BEGIN
  SELECT RAISE(ABORT, 'final owner protected');
END;

ALTER TABLE security_audit_events ADD COLUMN actor_system_role TEXT
  CHECK (actor_system_role IS NULL OR actor_system_role IN ('user','moderator','admin','owner','system'));
UPDATE security_audit_events SET actor_system_role = actor_type;

ALTER TABLE conversations ADD COLUMN description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 500);
ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
  CHECK (sort_order BETWEEN 0 AND 10000);
ALTER TABLE conversations ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_state IN ('active', 'archived'));
ALTER TABLE conversations ADD COLUMN admin_version INTEGER NOT NULL DEFAULT 1
  CHECK (admin_version > 0);
ALTER TABLE conversations ADD COLUMN updated_at TEXT;
UPDATE conversations SET description = COALESCE(topic, ''), updated_at = created_at;
CREATE INDEX idx_conversations_channel_admin
  ON conversations(type, lifecycle_state, sort_order, created_at, id);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY CHECK (key IN (
    'registration_enabled',
    'email_verification_required',
    'maintenance_mode',
    'max_message_length',
    'max_group_members',
    'max_upload_size_bytes',
    'max_avatar_size_bytes',
    'max_cover_size_bytes',
    'allow_group_creation',
    'allow_new_dm',
    'default_channel_id'
  )),
  value_json TEXT NOT NULL CHECK (length(value_json) <= 1024),
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'integer', 'string')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO system_settings (key, value_json, value_type) VALUES
  ('registration_enabled', 'true', 'boolean'),
  ('email_verification_required', 'true', 'boolean'),
  ('maintenance_mode', 'false', 'boolean'),
  ('max_message_length', '2000', 'integer'),
  ('max_group_members', '25', 'integer'),
  ('max_upload_size_bytes', '26214400', 'integer'),
  ('max_avatar_size_bytes', '5242880', 'integer'),
  ('max_cover_size_bytes', '5242880', 'integer'),
  ('allow_group_creation', 'true', 'boolean'),
  ('allow_new_dm', 'true', 'boolean'),
  ('default_channel_id', '"11111111-1111-4111-8111-111111111111"', 'string');
