export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly content: string;
  readonly replyToId: string | null;
  readonly clientOperationId: string | null;
  readonly isSystem: boolean;
  readonly editedAt: string | null;
  readonly deletedAt: string | null;
  readonly createdAt: string;
}

export interface ReactionSummary {
  readonly emoji: string;
  readonly userIds: string[];
}

export interface AttachmentSummary {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
}

/** Wire shape `Message` from docs/03-websocket-events.md. `reactions` (Phase 6) and
 * `attachments` (Phase 7) are both real data as of Phase 7 — passed in by the caller,
 * since both live in their own tables, not on the message row itself. */
export interface MessageSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly content: string;
  readonly replyToId: string | null;
  readonly isSystem: boolean;
  readonly edited: boolean;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly reactions: ReactionSummary[];
  readonly attachments: AttachmentSummary[];
}

export function toMessageSummary(
  message: Message,
  reactions: ReactionSummary[],
  attachments: AttachmentSummary[],
): MessageSummary {
  return {
    id: message.id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    content: message.content,
    replyToId: message.replyToId,
    isSystem: message.isSystem,
    edited: message.editedAt !== null,
    deletedAt: message.deletedAt,
    createdAt: message.createdAt,
    reactions,
    attachments,
  };
}
