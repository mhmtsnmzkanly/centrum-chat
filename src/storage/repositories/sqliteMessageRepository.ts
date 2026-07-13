import type { Db } from "../db.ts";
import type {
  MessageHistoryPage,
  MessageRepository,
  NewMessage,
} from "../../domain/messages/messageRepository.port.ts";
import type { Message } from "../../domain/messages/message.entity.ts";
import { escapeLikePattern } from "../sqlLike.ts";

interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string | null;
  content: string;
  reply_to_id: string | null;
  is_system: number;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    content: row.content,
    replyToId: row.reply_to_id,
    isSystem: row.is_system === 1,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

interface CursorRow {
  created_at: string;
  rowid: number;
}

/** All SQL for `messages` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  create(message: NewMessage): Message {
    this.db.prepare(
      `INSERT INTO messages (id, conversation_id, author_id, content, reply_to_id, is_system)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      message.conversationId,
      message.authorId,
      message.content,
      message.replyToId,
      message.isSystem ? 1 : 0,
    );

    const created = this.findById(message.id);
    if (!created) throw new Error("Failed to read back newly created message.");
    return created;
  }

  findById(id: string): Message | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | MessageRow
      | undefined;
    return row ? toMessage(row) : null;
  }

  updateContent(id: string, content: string): Message {
    this.db.prepare(
      `UPDATE messages SET content = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(content, id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back updated message.");
    return updated;
  }

  softDelete(id: string): Message {
    this.db.prepare(
      `UPDATE messages SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(id);

    const updated = this.findById(id);
    if (!updated) throw new Error("Failed to read back soft-deleted message.");
    return updated;
  }

  history(conversationId: string, before: string | null, limit: number): MessageHistoryPage {
    // `rowid` (SQLite's implicit integer key) breaks ties within the same created_at
    // millisecond, since `id` is a random UUID with no correlation to insertion order.
    let rows: MessageRow[];
    if (before) {
      const cursor = this.db.prepare("SELECT created_at, rowid FROM messages WHERE id = ?").get(
        before,
      ) as CursorRow | undefined;
      if (!cursor) {
        rows = [];
      } else {
        rows = this.db.prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
        ).all(
          conversationId,
          cursor.created_at,
          cursor.created_at,
          cursor.rowid,
          limit + 1,
        ) as unknown as MessageRow[];
      }
    } else {
      rows = this.db.prepare(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      ).all(conversationId, limit + 1) as unknown as MessageRow[];
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    page.reverse(); // ascending order for display
    return { messages: page.map(toMessage), hasMore };
  }

  search(conversationId: string, query: string, limit: number): Message[] {
    const pattern = `%${escapeLikePattern(query)}%`;
    const rows = this.db.prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL AND content LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(conversationId, pattern, limit) as unknown as MessageRow[];
    return rows.map(toMessage);
  }
}
