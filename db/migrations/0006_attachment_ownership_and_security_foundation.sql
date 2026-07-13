-- Security foundation: persist upload ownership so pending attachments can be
-- authorized safely before they are bound to a message.

ALTER TABLE attachments
ADD COLUMN uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Backfill message-bound attachments from their message author when possible.
UPDATE attachments
SET uploader_id = (
  SELECT messages.author_id
  FROM messages
  WHERE messages.id = attachments.message_id
)
WHERE message_id IS NOT NULL;

-- Backfill avatars and covers from the user profile URLs that reference them.
UPDATE attachments
SET uploader_id = (
  SELECT users.id
  FROM users
  WHERE users.avatar_url = '/media/' || attachments.id
)
WHERE uploader_id IS NULL AND kind = 'avatar';

UPDATE attachments
SET uploader_id = (
  SELECT users.id
  FROM users
  WHERE users.cover_url = '/media/' || attachments.id
)
WHERE uploader_id IS NULL AND kind = 'cover';

CREATE INDEX idx_attachments_uploader ON attachments(uploader_id);
