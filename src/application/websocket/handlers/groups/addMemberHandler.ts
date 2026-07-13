import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
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
import type { BlockPolicy } from "../../../../domain/safety/safetyPolicy.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.addMember`. */
export class AddMemberHandler implements EventHandler {
  readonly event = "group.addMember";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly groupService: GroupService,
    private readonly messageService: MessageService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly notificationService: NotificationService,
    private readonly transactions: TransactionManager,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly blockPolicy?: BlockPolicy,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.sanctionPolicy?.requireCanInteract(ctx.userId);
    const body = asRecord(data, "group.addMember data");
    const groupId = requireString(body, "groupId");
    const userId = requireString(body, "userId");
    this.blockPolicy?.requireDirectInteraction(ctx.userId, userId);

    const { result, systemMessage } = this.transactions.run(() => {
      const result = this.groupService.addMember(ctx.userId, groupId, userId);
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

    const trigger = this.notificationService.notifyGroupInvite(userId, groupId);
    this.connectionManager.sendToUser(
      trigger.userId,
      this.codec.encode(outboundPush("notification.new", { notification: trigger.notification })),
    );

    return {};
  }
}
