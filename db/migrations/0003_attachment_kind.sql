-- Phase 7 (media upload) distinguishes avatar uploads from message attachments: avatars
-- are served unauthenticated by GET /media/:id (an <img> tag never sends an
-- Authorization header), while message attachments are auth-gated by the owning room,
-- same as message.history. Both share the `attachments` table and `storage_path`
-- convention; `kind` is the only thing that tells them apart.
ALTER TABLE attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'attachment';
