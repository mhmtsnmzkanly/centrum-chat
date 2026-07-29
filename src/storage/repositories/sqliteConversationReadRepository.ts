import type { Db } from "../db.ts";
import type { ConversationReadRepository } from "../../domain/conversations/conversationReadRepository.port.ts";

/** All SQL for `conversation_reads` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteConversationReadRepository implements ConversationReadRepository {
  constructor(private readonly db: Db) {}

  markRead(conversationId: string, userId: string, messageId: string): boolean {
    // The SELECT is intentionally part of the write: a caller cannot point this
    // conversation's cursor at a message from another conversation (or an unknown id).
    const result = this.db.prepare(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, updated_at)
       SELECT ?, ?, messages.id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM messages
       WHERE messages.id = ? AND messages.conversation_id = ?
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET
         last_read_message_id = excluded.last_read_message_id,
         updated_at = excluded.updated_at`,
    ).run(conversationId, userId, messageId, conversationId);
    return Number(result.changes) === 1;
  }

  getLastReadMessageId(conversationId: string, userId: string): string | null {
    const row = this.db.prepare(
      "SELECT last_read_message_id FROM conversation_reads WHERE conversation_id = ? AND user_id = ?",
    ).get(conversationId, userId) as { last_read_message_id: string | null } | undefined;
    return row?.last_read_message_id ?? null;
  }

  countUnread(conversationId: string, userId: string): number {
    const lastReadId = this.getLastReadMessageId(conversationId, userId);

    if (!lastReadId) {
      const row = this.db.prepare(
        "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND deleted_at IS NULL",
      ).get(conversationId) as { count: number };
      return row.count;
    }

    // `rowid` (not created_at) is the comparison key: two messages can share the same
    // created_at millisecond under rapid sends, which would silently break a `>`
    // comparison on the timestamp alone. `rowid` is always strictly increasing by
    // insertion order regardless of timestamp collisions.
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL
         AND rowid > (SELECT rowid FROM messages WHERE id = ?)`,
    ).get(conversationId, lastReadId) as { count: number };
    return row.count;
  }
}
