import type { Conversation, ConversationType } from "./conversation.entity.ts";

export interface NewConversation {
  readonly id: string;
  readonly type: ConversationType;
  readonly slug?: string | null;
  readonly name?: string | null;
  readonly topic?: string | null;
  readonly ownerId?: string | null;
  readonly isPublic: boolean;
}

/** Port implemented by `storage/repositories/sqliteConversationRepository.ts`. Channels, groups
 * and DMs share one table (docs/02-database-schema.md design note); this port covers all
 * three room types uniformly plus the type-specific lookups each needs. */
export interface ConversationRepository {
  create(room: NewConversation): Conversation;
  findById(id: string): Conversation | null;
  findBySlug(slug: string): Conversation | null;
  listChannels(): Conversation[];
  listGroupsForUser(userId: string): Conversation[];
  /** Ordered by most recent message activity, per docs/03-websocket-events.md `dm.list`. */
  listDmsForUser(userId: string): Conversation[];
  findDmForPair(userIdA: string, userIdB: string): Conversation | null;
  delete(conversationId: string): void;
  transferOwnership(conversationId: string, newOwnerId: string): void;
}
