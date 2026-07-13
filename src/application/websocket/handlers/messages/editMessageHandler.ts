import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { MessageSummary } from "../../../../domain/messages/message.entity.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience } from "../../conversationFanout.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";

/** docs/03-websocket-events.md "Module: Messages" — `message.edit`, author-only. */
export class EditMessageHandler implements EventHandler {
  readonly event = "message.edit";

  constructor(
    private readonly messageService: MessageService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly maxMessageLength: () => number = () => 4000,
  ) {}

  handle(ctx: HandlerContext, data: unknown): { message: MessageSummary } {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.sanctionPolicy?.requireCanMessage(ctx.userId);
    const body = asRecord(data, "message.edit data");
    const messageId = requireString(body, "messageId");
    const content = requireString(body, "content", {
      minLength: 1,
      maxLength: this.maxMessageLength(),
    });

    const message = this.messageService.edit(ctx.userId, messageId, content);

    const room = this.roomRepository.findById(message.conversationId);
    if (room) {
      pushToRoomAudience(
        room,
        this.codec.encode(outboundPush("message.updated", { message })),
        this.connectionManager,
        this.roomMemberRepository,
      );
    }

    return { message };
  }
}
