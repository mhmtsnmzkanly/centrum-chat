import type { Conversation } from "../conversations/conversation.entity.ts";
import type { ConversationMembershipRepository } from "../conversations/conversationMembershipRepository.port.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";

/** Single place authorization branches on room.type (architecture doc §13): `channel` ->
 * always allow read/post for any authenticated user; `group`/`dm` -> require a
 * `conversation_memberships` row, deny otherwise. */
export class PermissionService {
  constructor(private readonly roomMembers: ConversationMembershipRepository) {}

  canAccessRoom(room: Conversation, userId: string): boolean {
    if (room.type === "channel") return true;
    return this.roomMembers.isMember(room.id, userId);
  }

  requireAccess(room: Conversation, userId: string): void {
    if (!this.canAccessRoom(room, userId)) {
      throw new ForbiddenError("You do not have access to this room.", { conversationId: room.id });
    }
  }

  /** Elevated actions (e.g. deleting another user's message): group/dm owner or
   * moderator, or a channel's optional sparse `role='moderator'` row. */
  isModerator(room: Conversation, userId: string): boolean {
    const member = this.roomMembers.findMember(room.id, userId);
    return member?.role === "owner" || member?.role === "moderator";
  }
}
