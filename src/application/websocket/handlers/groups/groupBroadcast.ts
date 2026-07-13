import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";
import type { MessageSummary } from "../../../../domain/messages/message.entity.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience } from "../../conversationFanout.ts";

export interface GroupBroadcastDeps {
  readonly roomRepository: ConversationRepository;
  readonly roomMemberRepository: ConversationMembershipRepository;
  readonly connectionManager: ConnectionManager;
  readonly codec: ProtocolCodec;
}

/** Broadcasts the already-persisted group system message (`message.new`) and the
 * corresponding `room.updated` (docs/03-websocket-events.md "Module: Groups") to every
 * current member of the group — shared by create/addMember/removeMember/leave, which all
 * end the same way. A null `room` (the `leave` call that deleted the room because the last
 * member left) is a no-op: there's no one left to broadcast to. */
export function broadcastGroupMutation(
  deps: GroupBroadcastDeps,
  room: ConversationSummary | null,
  systemMessage: MessageSummary | null,
): void {
  if (!room || !systemMessage) return;
  const fullRoom = deps.roomRepository.findById(room.id);
  if (!fullRoom) return;

  pushToRoomAudience(
    fullRoom,
    deps.codec.encode(outboundPush("message.new", { message: systemMessage })),
    deps.connectionManager,
    deps.roomMemberRepository,
  );
  pushToRoomAudience(
    fullRoom,
    deps.codec.encode(outboundPush("room.updated", { room })),
    deps.connectionManager,
    deps.roomMemberRepository,
  );
}
