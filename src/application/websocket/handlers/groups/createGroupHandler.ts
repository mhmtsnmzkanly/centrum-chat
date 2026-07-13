import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";
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
import { ValidationError } from "../../../../shared/errors/validationError.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";
import type { BlockPolicy } from "../../../../domain/safety/safetyPolicy.ts";
import type { SettingsService } from "../../../../domain/administration/settingsService.ts";
import { MaintenanceModeError } from "../../../../domain/administration/administrationErrors.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.create`. */
export class CreateGroupHandler implements EventHandler {
  readonly event = "group.create";
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
    private readonly settings?: SettingsService,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): { room: ConversationSummary } {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.sanctionPolicy?.requireCanInteract(ctx.userId);
    if (this.settings && !this.settings.get<boolean>("allow_group_creation")) {
      throw new MaintenanceModeError("Group creation is currently disabled.");
    }
    const body = asRecord(data, "group.create data");
    const name = requireString(body, "name", { minLength: 1, maxLength: 100 });

    const memberIds = body["memberIds"];
    if (!Array.isArray(memberIds) || !memberIds.every((id) => typeof id === "string")) {
      throw new ValidationError('"memberIds" must be an array of strings.', {
        field: "memberIds",
      });
    }
    for (const memberId of memberIds) {
      this.blockPolicy?.requireDirectInteraction(ctx.userId, memberId);
    }

    const { result, systemMessage } = this.transactions.run(() => {
      const result = this.groupService.create(ctx.userId, name, memberIds);
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

    for (const invitedUserId of result.addedMemberIds) {
      const trigger = this.notificationService.notifyGroupInvite(invitedUserId, result.room.id);
      this.connectionManager.sendToUser(
        trigger.userId,
        this.codec.encode(outboundPush("notification.new", { notification: trigger.notification })),
      );
    }

    return { room: result.room };
  }
}
