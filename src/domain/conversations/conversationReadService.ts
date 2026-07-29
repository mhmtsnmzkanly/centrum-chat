import type { ConversationReadRepository } from "./conversationReadRepository.port.ts";
import type { ConversationRepository } from "./conversationRepository.port.ts";
import type { Conversation } from "./conversation.entity.ts";
import type { PermissionService } from "../permissions/permissionService.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";

/** docs/03-websocket-events.md "Module: Messages" — `room.markRead`. Works uniformly
 * across all room types since `conversation_reads` is decoupled from `conversation_memberships`
 * (docs/02-database-schema.md). */
export class ConversationReadService {
  constructor(
    private readonly roomReads: ConversationReadRepository,
    private readonly rooms: ConversationRepository,
    private readonly permissions: PermissionService,
  ) {}

  markRead(userId: string, conversationId: string, messageId: string): void {
    const room = this.requireRoom(conversationId);
    this.permissions.requireAccess(room, userId);
    if (!this.roomReads.markRead(conversationId, userId, messageId)) {
      throw new ValidationError('"messageId" must refer to a message in the same conversation.', {
        field: "messageId",
      });
    }
  }

  countUnread(conversationId: string, userId: string): number {
    return this.roomReads.countUnread(conversationId, userId);
  }

  private requireRoom(conversationId: string): Conversation {
    const room = this.rooms.findById(conversationId);
    if (!room) throw new NotFoundError("Conversation not found.", { conversationId });
    return room;
  }
}
