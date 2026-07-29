-- Optional client operation ids make message.send retry-safe for upgraded clients.
-- NULL preserves legacy clients, which keep the pre-existing at-least-once behavior.
ALTER TABLE messages ADD COLUMN client_operation_id TEXT;

-- The operation id is deliberately unique per author across all conversations. Reusing it
-- with a different conversation is therefore detected as a conflicting payload rather than
-- silently returning an unrelated message. System messages have no operation ids.
CREATE UNIQUE INDEX idx_messages_author_client_operation
  ON messages(author_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
