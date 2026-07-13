-- Terminology migration: rooms/sessions -> conversations/user_sessions.
-- Preserves existing rows by using SQLite rename operations and explicit index
-- recreation for the renamed table/index names.

ALTER TABLE rooms RENAME TO conversations;
ALTER TABLE room_members RENAME TO conversation_memberships;
ALTER TABLE room_reads RENAME TO conversation_reads;
ALTER TABLE refresh_tokens RENAME TO user_sessions;

ALTER TABLE messages RENAME COLUMN room_id TO conversation_id;
ALTER TABLE conversation_memberships RENAME COLUMN room_id TO conversation_id;
ALTER TABLE conversation_reads RENAME COLUMN room_id TO conversation_id;
ALTER TABLE notifications RENAME COLUMN room_id TO conversation_id;
ALTER TABLE user_sessions RENAME COLUMN token_hash TO refresh_token_hash;

DROP INDEX IF EXISTS idx_messages_room_created;
DROP INDEX IF EXISTS idx_room_members_user;
DROP INDEX IF EXISTS idx_room_reads_user;
DROP INDEX IF EXISTS idx_refresh_tokens_user;

CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE INDEX idx_conversation_memberships_user ON conversation_memberships(user_id);
CREATE INDEX idx_conversation_reads_user ON conversation_reads(user_id);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
