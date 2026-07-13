export type ConversationType = "channel" | "group" | "dm";

export interface Conversation {
  readonly id: string;
  readonly type: ConversationType;
  readonly slug: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly ownerId: string | null;
  readonly isPublic: boolean;
  readonly description: string;
  readonly sortOrder: number;
  readonly lifecycleState: "active" | "archived";
  readonly adminVersion: number;
  readonly updatedAt: string;
  readonly createdAt: string;
}

/** Wire shape `Conversation` from docs/03-websocket-events.md. `memberCount` is derived (not
 * stored) and null for channels, which never track per-user membership. */
export interface ConversationSummary {
  readonly id: string;
  readonly type: ConversationType;
  readonly slug: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly ownerId: string | null;
  readonly memberCount: number | null;
  readonly createdAt: string;
}

export function toConversationSummary(
  conversation: Conversation,
  memberCount: number | null,
): ConversationSummary {
  return {
    id: conversation.id,
    type: conversation.type,
    slug: conversation.slug,
    name: conversation.name,
    topic: conversation.topic,
    ownerId: conversation.ownerId,
    memberCount,
    createdAt: conversation.createdAt,
  };
}
