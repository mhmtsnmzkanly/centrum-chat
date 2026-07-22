import type { MessageRepository } from "./messageRepository.port.ts";
import type { Message, MessageSummary } from "./message.entity.ts";
import { toMessageSummary } from "./message.entity.ts";
import type { ConversationRepository } from "../conversations/conversationRepository.port.ts";
import type { Conversation } from "../conversations/conversation.entity.ts";
import type { PermissionService } from "../permissions/permissionService.ts";
import type { RateLimiter } from "../../shared/rateLimit/rateLimiter.ts";
import type { ReactionRepository } from "../reactions/reactionRepository.port.ts";
import type { AttachmentRepository } from "../attachments/attachmentRepository.port.ts";
import { toAttachmentSummary } from "../attachments/attachment.entity.ts";
import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";
import { RateLimitedError } from "../../shared/errors/rateLimitedError.ts";
import { generateId } from "../../shared/id.ts";

export interface MessageHistoryResult {
  readonly messages: MessageSummary[];
  readonly hasMore: boolean;
}

export interface IdempotentSendResult {
  readonly message: MessageSummary;
  /** False only for an exact replay of an upgraded client's earlier operation. */
  readonly created: boolean;
}

/** docs/03-websocket-events.md "Module: Messages". Conversation access rules follow
 * architecture doc §13 via PermissionService: open for channels, `conversation_memberships`-gated
 * for group/dm. */
export class MessageService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly rooms: ConversationRepository,
    private readonly permissions: PermissionService,
    private readonly rateLimiter: RateLimiter,
    private readonly transactions: TransactionManager,
    private readonly reactions: ReactionRepository,
    private readonly attachments: AttachmentRepository,
    private readonly safetyGuard?: {
      requireMessage(userId: string, room: Conversation): void;
      requireMutation?(userId: string, room: Conversation): void;
    },
  ) {}

  /** Exposed so `SearchService` can turn its own `search.messages` matches into the
   * same wire shape without re-deriving the reactions/attachments assembly. */
  toSummaries(messages: Message[]): MessageSummary[] {
    return messages.map((message) => this.toSummary(message));
  }

  private toSummary(message: Message): MessageSummary {
    return toMessageSummary(
      message,
      this.reactions.listForMessage(message.id),
      this.attachments.listForMessage(message.id).map(toAttachmentSummary),
    );
  }

  /** Server-generated messages (group create/add/remove/leave — docs/06-implementation-plan.md
   * Phase 4 "system messages") bypass permission/rate-limit checks entirely, since they're
   * never triggered by raw client input; `authorId` is null, matching `messages.author_id`'s
   * nullability for exactly this case. */
  postSystemMessage(conversationId: string, content: string): MessageSummary {
    const message = this.transactions.run(() =>
      this.messages.create({
        id: generateId(),
        conversationId,
        authorId: null,
        content,
        replyToId: null,
        isSystem: true,
      })
    );
    return this.toSummary(message);
  }

  send(
    userId: string,
    conversationId: string,
    content: string,
    replyToId: string | null,
    attachmentId: string | null = null,
    clientOperationId: string | null = null,
  ): MessageSummary {
    return this.sendIdempotent(
      userId,
      conversationId,
      content,
      replyToId,
      attachmentId,
      clientOperationId,
    ).message;
  }

  /**
   * Creates a message once for an upgraded client's operation id. Legacy callers pass
   * null and retain the prior at-least-once send behavior. A replay never rebinds media
   * or creates another message; callers use `created` to suppress downstream effects.
   */
  sendIdempotent(
    userId: string,
    conversationId: string,
    content: string,
    replyToId: string | null,
    attachmentId: string | null = null,
    clientOperationId: string | null = null,
  ): IdempotentSendResult {
    const room = this.requireRoom(conversationId);
    this.permissions.requireAccess(room, userId);

    if (clientOperationId) {
      const existing = this.messages.findByClientOperationId(userId, clientOperationId);
      if (existing) {
        return this.replayedResult(existing, conversationId, content, replyToId, attachmentId);
      }
    }

    if (!this.rateLimiter.check(`message.send:${userId}`)) {
      throw new RateLimitedError("You are sending messages too quickly.");
    }

    if (replyToId) {
      const replyTarget = this.messages.findById(replyToId);
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        throw new ValidationError('"replyToId" must refer to a message in the same room.', {
          field: "replyToId",
        });
      }
    }

    let created: Message;
    let replayedInsideTransaction = false;
    try {
      created = this.transactions.run(() => {
        if (clientOperationId) {
          const existing = this.messages.findByClientOperationId(userId, clientOperationId);
          if (existing) {
            replayedInsideTransaction = true;
            return existing;
          }
        }
        this.safetyGuard?.requireMessage(userId, room);
        if (attachmentId) {
          const attachment = this.attachments.findById(attachmentId);
          if (!attachment || attachment.kind !== "attachment" || attachment.messageId !== null) {
            throw new ValidationError(
              '"attachmentId" must refer to a previously uploaded file not yet attached to a message.',
              { field: "attachmentId" },
            );
          }
          if (attachment.uploaderId !== userId) {
            throw new ForbiddenError("You can only attach files you uploaded yourself.");
          }
        }

        const inserted = this.messages.create({
          id: generateId(),
          conversationId,
          authorId: userId,
          content,
          replyToId,
          clientOperationId,
          isSystem: false,
        });
        if (attachmentId) {
          this.attachments.attachToMessage(attachmentId, inserted.id);
        }
        return inserted;
      });
    } catch (error) {
      if (!clientOperationId) throw error;
      const existing = this.messages.findByClientOperationId(userId, clientOperationId);
      if (!existing) throw error;
      return this.replayedResult(existing, conversationId, content, replyToId, attachmentId);
    }

    if (replayedInsideTransaction) {
      return this.replayedResult(created, conversationId, content, replyToId, attachmentId);
    }
    return { message: this.toSummary(created), created: true };
  }

  private replayedResult(
    existing: Message,
    conversationId: string,
    content: string,
    replyToId: string | null,
    attachmentId: string | null,
  ): IdempotentSendResult {
    const existingAttachmentIds = this.attachments.listForMessage(existing.id).map((item) =>
      item.id
    );
    const attachmentMatches = attachmentId === null
      ? existingAttachmentIds.length === 0
      : existingAttachmentIds.length === 1 && existingAttachmentIds[0] === attachmentId;
    if (
      existing.conversationId !== conversationId || existing.content !== content ||
      existing.replyToId !== replyToId || !attachmentMatches
    ) {
      throw new ConflictError(
        "clientOperationId was already used with a different message payload.",
        {
          field: "clientOperationId",
        },
      );
    }
    return { message: this.toSummary(existing), created: false };
  }

  edit(userId: string, messageId: string, content: string): MessageSummary {
    const message = this.requireMessage(messageId);
    const room = this.requireRoom(message.conversationId);
    if (message.authorId !== userId) {
      throw new ForbiddenError("Only the author can edit this message.");
    }
    if (message.deletedAt) {
      throw new ForbiddenError("Cannot edit a deleted message.");
    }
    this.safetyGuard?.requireMutation?.(userId, room);
    return this.toSummary(this.messages.updateContent(messageId, content));
  }

  /** Author, or (group/dm) room owner/moderator, or (channel) a user holding an
   * optional `role='moderator'` row for that channel. Returns the soft-deleted message
   * so callers can broadcast `message.updated`. */
  delete(userId: string, messageId: string): MessageSummary {
    const message = this.requireMessage(messageId);
    const room = this.requireRoom(message.conversationId);
    const isAuthor = message.authorId === userId;
    if (!isAuthor && !this.permissions.isModerator(room, userId)) {
      throw new ForbiddenError("You cannot delete this message.");
    }
    this.safetyGuard?.requireMutation?.(userId, room);
    return this.toSummary(this.messages.softDelete(messageId));
  }

  history(
    userId: string,
    conversationId: string,
    before: string | null,
    limit: number,
  ): MessageHistoryResult {
    const room = this.requireRoom(conversationId);
    this.permissions.requireAccess(room, userId);
    const page = this.messages.history(conversationId, before, limit);
    return {
      messages: page.messages.map((message) => this.toSummary(message)),
      hasMore: page.hasMore,
    };
  }

  private requireRoom(conversationId: string): Conversation {
    const room = this.rooms.findById(conversationId);
    if (!room) throw new NotFoundError("Conversation not found.", { conversationId });
    return room;
  }

  private requireMessage(messageId: string): Message {
    const message = this.messages.findById(messageId);
    if (!message) throw new NotFoundError("Message not found.", { messageId });
    return message;
  }
}
