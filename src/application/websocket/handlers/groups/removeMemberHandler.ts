import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TransactionManager } from "../../../../shared/transactions/transactionManager.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { broadcastGroupMutation } from "./groupBroadcast.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.removeMember`. `room.updated`
 * additionally goes directly to the removed user (docs: "for removal, the removed
 * members" too) since they're no longer in `conversation_memberships` and so wouldn't otherwise be
 * part of the broadcast audience. */
export class RemoveMemberHandler implements EventHandler {
  readonly event = "group.removeMember";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly groupService: GroupService,
    private readonly messageService: MessageService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly transactions: TransactionManager,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly sanctionPolicy?: SanctionPolicy,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.sanctionPolicy?.requireCanInteract(ctx.userId);
    const body = asRecord(data, "group.removeMember data");
    const groupId = requireString(body, "groupId");
    const userId = requireString(body, "userId");

    const { result, systemMessage } = this.transactions.run(() => {
      const result = this.groupService.removeMember(ctx.userId, groupId, userId);
      const systemMessage = this.messageService.postSystemMessage(
        result.room.id,
        result.systemMessageText,
      );
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

    this.connectionManager.sendToUser(
      userId,
      this.codec.encode(outboundPush("room.updated", { room: result.room })),
    );

    return {};
  }
}
