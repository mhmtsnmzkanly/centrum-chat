import type { Db } from "../db.ts";
import type {
  ConversationMember,
  ConversationMemberRole,
  ConversationMembershipRepository,
} from "../../domain/conversations/conversationMembershipRepository.port.ts";

interface RoomMemberRow {
  conversation_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

function toRoomMember(row: RoomMemberRow): ConversationMember {
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role as ConversationMemberRole,
    joinedAt: row.joined_at,
  };
}

/** All SQL for `conversation_memberships` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteConversationMembershipRepository implements ConversationMembershipRepository {
  constructor(private readonly db: Db) {}

  add(conversationId: string, userId: string, role: ConversationMemberRole): void {
    this.db.prepare(
      "INSERT INTO conversation_memberships (conversation_id, user_id, role) VALUES (?, ?, ?)",
    ).run(conversationId, userId, role);
  }

  remove(conversationId: string, userId: string): void {
    this.db.prepare(
      "DELETE FROM conversation_memberships WHERE conversation_id = ? AND user_id = ?",
    ).run(
      conversationId,
      userId,
    );
  }

  findMember(conversationId: string, userId: string): ConversationMember | null {
    const row = this.db.prepare(
      "SELECT * FROM conversation_memberships WHERE conversation_id = ? AND user_id = ?",
    ).get(conversationId, userId) as RoomMemberRow | undefined;
    return row ? toRoomMember(row) : null;
  }

  listMembers(conversationId: string): ConversationMember[] {
    const rows = this.db.prepare("SELECT * FROM conversation_memberships WHERE conversation_id = ?")
      .all(
        conversationId,
      ) as unknown as RoomMemberRow[];
    return rows.map(toRoomMember);
  }

  isMember(conversationId: string, userId: string): boolean {
    return this.findMember(conversationId, userId) !== null;
  }

  countMembers(conversationId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM conversation_memberships WHERE conversation_id = ?",
    ).get(conversationId) as { count: number };
    return row.count;
  }

  updateRole(conversationId: string, userId: string, role: ConversationMemberRole): void {
    this.db.prepare(
      "UPDATE conversation_memberships SET role = ? WHERE conversation_id = ? AND user_id = ?",
    ).run(role, conversationId, userId);
  }

  sharesGroupWith(userIdA: string, userIdB: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM conversation_memberships cm1
       JOIN conversation_memberships cm2 ON cm1.conversation_id = cm2.conversation_id
       JOIN conversations ON conversations.id = cm1.conversation_id
       WHERE conversations.type = 'group' AND cm1.user_id = ? AND cm2.user_id = ?
       LIMIT 1`,
    ).get(userIdA, userIdB);
    return row !== undefined;
  }
}
