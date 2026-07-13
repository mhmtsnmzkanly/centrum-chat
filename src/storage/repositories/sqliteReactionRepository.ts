import type { Db } from "../db.ts";
import type { ReactionRepository } from "../../domain/reactions/reactionRepository.port.ts";
import type { ReactionSummary } from "../../domain/messages/message.entity.ts";

interface ReactionRow {
  emoji: string;
  user_id: string;
}

/** All SQL for `reactions` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteReactionRepository implements ReactionRepository {
  constructor(private readonly db: Db) {}

  exists(messageId: string, userId: string, emoji: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
    ).get(messageId, userId, emoji);
    return row !== undefined;
  }

  add(messageId: string, userId: string, emoji: string): void {
    this.db.prepare(
      "INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)",
    ).run(messageId, userId, emoji);
  }

  remove(messageId: string, userId: string, emoji: string): void {
    this.db.prepare(
      "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
    ).run(messageId, userId, emoji);
  }

  listForMessage(messageId: string): ReactionSummary[] {
    const rows = this.db.prepare(
      "SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY emoji",
    ).all(messageId) as unknown as ReactionRow[];

    const byEmoji = new Map<string, string[]>();
    for (const row of rows) {
      const userIds = byEmoji.get(row.emoji) ?? [];
      userIds.push(row.user_id);
      byEmoji.set(row.emoji, userIds);
    }
    return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
  }
}
