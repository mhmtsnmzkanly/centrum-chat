import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TransactionManager } from "../../../../shared/transactions/transactionManager.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { broadcastGroupMutation } from "./groupBroadcast.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.leave`. No broadcast happens
 * when the leaver was the last member (the room itself was deleted — nothing left to
 * notify), handled by `broadcastGroupMutation`'s null-room no-op. */
export class LeaveGroupHandler implements EventHandler {
  readonly event = "group.leave";

  constructor(
    private readonly groupService: GroupService,
    private readonly messageService: MessageService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly transactions: TransactionManager,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
  ) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    const body = asRecord(data, "group.leave data");
    const groupId = requireString(body, "groupId");

    const { result, systemMessage } = this.transactions.run(() => {
      const result = this.groupService.leave(ctx.userId, groupId);
      const systemMessage = result.room
        ? this.messageService.postSystemMessage(result.room.id, result.systemMessageText)
        : null;
      return { result, systemMessage };
    });

    broadcastGroupMutation(
      {
        roomRepository: this.roomRepository,
        roomMemberRepository: this.roomMemberRepository,
        connectionManager: this.connectionManager,
        codec: this.codec,
      },
      result.room,
      systemMessage,
    );

    return {};
  }
}
