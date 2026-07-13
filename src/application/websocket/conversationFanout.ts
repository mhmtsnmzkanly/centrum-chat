import type { ConnectionManager } from "../../transport/websocket/connectionManager.ts";
import type { ConversationMembershipRepository } from "../../domain/conversations/conversationMembershipRepository.port.ts";
import type { Conversation } from "../../domain/conversations/conversation.entity.ts";

/** Fan-out target differs by room type (architecture doc §4): channel pushes go to
 * every currently-connected socket (channels are public, no subscription list to
 * consult); group/dm pushes go only to users with a `conversation_memberships` row. Shared by every
 * WS handler that needs to push a room-scoped event (`message.new`, `message.updated`, ...). */
export function roomAudienceUserIds(
  room: Conversation,
  connectionManager: ConnectionManager,
  roomMembers: ConversationMembershipRepository,
): string[] {
  if (room.type === "channel") return connectionManager.connectedUserIds();
  return roomMembers.listMembers(room.id).map((member) => member.userId);
}

export function pushToRoomAudience(
  room: Conversation,
  encoded: string,
  connectionManager: ConnectionManager,
  roomMembers: ConversationMembershipRepository,
): void {
  if (room.type === "channel") {
    connectionManager.broadcastToAll(encoded);
    return;
  }
  for (const userId of roomAudienceUserIds(room, connectionManager, roomMembers)) {
    connectionManager.sendToUser(userId, encoded);
  }
}
