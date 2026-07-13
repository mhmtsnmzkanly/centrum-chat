import type { Db } from "../db.ts";
import type { DirectConversationPairRepository } from "../../domain/conversations/directConversationPairRepository.port.ts";
import { canonicalizeDirectConversationPair } from "../../domain/conversations/directConversationPair.ts";

interface DirectConversationPairRow {
  conversation_id: string;
}

/** All SQL for `direct_conversation_pairs` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteDirectConversationPairRepository implements DirectConversationPairRepository {
  constructor(private readonly db: Db) {}

  findConversationIdByUsers(userAId: string, userBId: string): string | null {
    const { userLowId, userHighId } = canonicalizeDirectConversationPair(userAId, userBId);
    const row = this.db.prepare(
      `SELECT conversation_id FROM direct_conversation_pairs
       WHERE user_low_id = ? AND user_high_id = ?`,
    ).get(userLowId, userHighId) as DirectConversationPairRow | undefined;
    return row?.conversation_id ?? null;
  }

  createPair(conversationId: string, userAId: string, userBId: string): void {
    const { userLowId, userHighId } = canonicalizeDirectConversationPair(userAId, userBId);
    this.db.prepare(
      `INSERT INTO direct_conversation_pairs (conversation_id, user_low_id, user_high_id)
       VALUES (?, ?, ?)`,
    ).run(conversationId, userLowId, userHighId);
  }
}
