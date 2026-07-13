import type { ReactionRepository } from "./reactionRepository.port.ts";
import type { MessageRepository } from "../messages/messageRepository.port.ts";
import type { ConversationRepository } from "../conversations/conversationRepository.port.ts";
import type { PermissionService } from "../permissions/permissionService.ts";
import type { ReactionSummary } from "../messages/message.entity.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";

export interface ReactionToggleResult {
  readonly conversationId: string;
  readonly reactions: ReactionSummary[];
  readonly added: boolean;
  readonly messageAuthorId: string | null;
}

/** docs/03-websocket-events.md "Module: Reactions" — `reaction.toggle`: adds if the
 * caller hasn't reacted with that emoji yet, removes if they have. */
export class ReactionService {
  constructor(
    private readonly reactions: ReactionRepository,
    private readonly messages: MessageRepository,
    private readonly rooms: ConversationRepository,
    private readonly permissions: PermissionService,
  ) {}

  toggle(userId: string, messageId: string, emoji: string): ReactionToggleResult {
    const message = this.messages.findById(messageId);
    if (!message) throw new NotFoundError("Message not found.", { messageId });

    const room = this.rooms.findById(message.conversationId);
    if (!room) {
      throw new NotFoundError("Conversation not found.", {
        conversationId: message.conversationId,
      });
    }
    this.permissions.requireAccess(room, userId);

    let added: boolean;
    if (this.reactions.exists(messageId, userId, emoji)) {
      this.reactions.remove(messageId, userId, emoji);
      added = false;
    } else {
      this.reactions.add(messageId, userId, emoji);
      added = true;
    }

    return {
      conversationId: message.conversationId,
      reactions: this.reactions.listForMessage(messageId),
      added,
      messageAuthorId: message.authorId,
    };
  }
}
