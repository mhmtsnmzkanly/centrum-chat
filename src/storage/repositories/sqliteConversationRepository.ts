import type { Db } from "../db.ts";
import type {
  ConversationRepository,
  NewConversation,
} from "../../domain/conversations/conversationRepository.port.ts";
import type {
  Conversation,
  ConversationType,
} from "../../domain/conversations/conversation.entity.ts";
import { canonicalizeDirectConversationPair } from "../../domain/conversations/directConversationPair.ts";

interface ConversationRow {
  id: string;
  type: string;
  slug: string | null;
  name: string | null;
  topic: string | null;
  owner_id: string | null;
  is_public: number;
  created_at: string;
  description: string;
  sort_order: number;
  lifecycle_state: "active" | "archived";
  admin_version: number;
  updated_at: string;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    type: row.type as ConversationType,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    ownerId: row.owner_id,
    isPublic: row.is_public === 1,
    description: row.description,
    sortOrder: row.sort_order,
    lifecycleState: row.lifecycle_state,
    adminVersion: row.admin_version,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** All SQL for `conversations` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly db: Db) {}

  create(room: NewConversation): Conversation {
    this.db.prepare(
      `INSERT INTO conversations (id, type, slug, name, topic, owner_id, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      room.id,
      room.type,
      room.slug ?? null,
      room.name ?? null,
      room.topic ?? null,
      room.ownerId ?? null,
      room.isPublic ? 1 : 0,
    );

    const created = this.findById(room.id);
    if (!created) throw new Error("Failed to read back newly created room.");
    return created;
  }

  findById(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | ConversationRow
      | undefined;
    return row ? toConversation(row) : null;
  }

  findBySlug(slug: string): Conversation | null {
    const row = this.db.prepare(
      "SELECT * FROM conversations WHERE type = 'channel' AND slug = ?",
    ).get(
      slug,
    ) as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  listChannels(): Conversation[] {
    const rows = this.db.prepare(
      "SELECT * FROM conversations WHERE type = 'channel' AND lifecycle_state='active' ORDER BY sort_order,slug",
    ).all() as unknown as ConversationRow[];
    return rows.map(toConversation);
  }

  listGroupsForUser(userId: string): Conversation[] {
    const rows = this.db.prepare(
      `SELECT conversations.* FROM conversations
       JOIN conversation_memberships ON conversation_memberships.conversation_id = conversations.id
       WHERE conversations.type = 'group' AND conversation_memberships.user_id = ?
       ORDER BY conversations.created_at DESC`,
    ).all(userId) as unknown as ConversationRow[];
    return rows.map(toConversation);
  }

  listDmsForUser(userId: string): Conversation[] {
    // Recent-activity ordering: most recent message first, falling back to room
    // creation time for DMs with no messages yet.
    const rows = this.db.prepare(
      `SELECT conversations.* FROM conversations
       JOIN conversation_memberships ON conversation_memberships.conversation_id = conversations.id
       WHERE conversations.type = 'dm' AND conversation_memberships.user_id = ?
       ORDER BY COALESCE(
         (SELECT MAX(created_at) FROM messages WHERE messages.conversation_id = conversations.id),
         conversations.created_at
       ) DESC`,
    ).all(userId) as unknown as ConversationRow[];
    return rows.map(toConversation);
  }

  findDmForPair(userIdA: string, userIdB: string): Conversation | null {
    const { userLowId, userHighId } = canonicalizeDirectConversationPair(userIdA, userIdB);
    const row = this.db.prepare(
      `SELECT conversations.* FROM conversations
       JOIN direct_conversation_pairs ON direct_conversation_pairs.conversation_id = conversations.id
       WHERE conversations.type = 'dm'
         AND direct_conversation_pairs.user_low_id = ?
         AND direct_conversation_pairs.user_high_id = ?`,
    ).get(userLowId, userHighId) as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  delete(conversationId: string): void {
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  }

  transferOwnership(conversationId: string, newOwnerId: string): void {
    this.db.prepare("UPDATE conversations SET owner_id = ? WHERE id = ?").run(
      newOwnerId,
      conversationId,
    );
  }
}
