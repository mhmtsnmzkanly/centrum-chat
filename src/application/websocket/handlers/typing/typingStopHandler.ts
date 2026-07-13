import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { TypingService } from "../../../../domain/typing/typingService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { PermissionService } from "../../../../domain/permissions/permissionService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience } from "../../conversationFanout.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { NotFoundError } from "../../../../shared/errors/notFoundError.ts";

/** docs/03-websocket-events.md "Module: Typing Indicators" — `typing.stop`. */
export class TypingStopHandler implements EventHandler {
  readonly event = "typing.stop";

  constructor(
    private readonly typingService: TypingService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly permissionService: PermissionService,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
  ) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    const body = asRecord(data, "typing.stop data");
    const conversationId = requireString(body, "conversationId");

    const room = this.roomRepository.findById(conversationId);
    if (!room) throw new NotFoundError("Conversation not found.", { conversationId });
    this.permissionService.requireAccess(room, ctx.userId);

    this.typingService.stop(conversationId, ctx.userId);
    pushToRoomAudience(
      room,
      this.codec.encode(
        outboundPush("typing.updated", { conversationId, userId: ctx.userId, isTyping: false }),
      ),
      this.connectionManager,
      this.roomMemberRepository,
    );

    return {};
  }
}
