import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience } from "../../conversationFanout.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import {
  asRecord,
  optionalBoolean,
  requireString,
} from "../../../../shared/validation/validator.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

/** docs/03-websocket-events.md "Module: Messages" — `message.delete`. Author, or
 * (group/dm) room owner/moderator, or (channel) a user holding an optional
 * `role='moderator'` row; soft delete, broadcast as `message.updated`. */
export class DeleteMessageHandler implements EventHandler {
  readonly event = "message.delete";

  constructor(
    private readonly messageService: MessageService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
  ) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    const body = asRecord(data, "message.delete data");
    const messageId = requireString(body, "messageId");
    const confirm = optionalBoolean(body, "confirm");

    if (confirm !== true) {
      throw new ValidationError('"confirm" must be true to delete a message.', {
        field: "confirm",
      });
    }

    const message = this.messageService.delete(ctx.userId, messageId);

    const room = this.roomRepository.findById(message.conversationId);
    if (room) {
      pushToRoomAudience(
        room,
        this.codec.encode(outboundPush("message.updated", { message })),
        this.connectionManager,
        this.roomMemberRepository,
      );
    }

    return {};
  }
}
