import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { ConversationReadService } from "../../../../domain/conversations/conversationReadService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { MessageSummary } from "../../../../domain/messages/message.entity.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience, roomAudienceUserIds } from "../../conversationFanout.ts";
import {
  asRecord,
  optionalString,
  requireString,
} from "../../../../shared/validation/validator.ts";
import type { SettingsService } from "../../../../domain/administration/settingsService.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";
import type { TransactionManager } from "../../../../shared/transactions/transactionManager.ts";

/** docs/03-websocket-events.md "Module: Messages" — `message.send`. Pushes `message.new`
 * to the room's audience and `unread.updated` to every other recipient (not the sender). */
export class SendMessageHandler implements EventHandler {
  readonly event = "message.send";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly messageService: MessageService,
    private readonly roomReadService: ConversationReadService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly notificationService: NotificationService,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly settings?: SettingsService,
    private readonly runtimePolicy?: RuntimePolicy,
    private readonly transactions?: TransactionManager,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): { message: MessageSummary; replayed: boolean } {
    const body = asRecord(data, "message.send data");
    const conversationId = requireString(body, "conversationId");
    const content = requireString(body, "content", {
      minLength: 1,
      maxLength: this.settings?.get<number>("max_message_length") ?? 4000,
    });
    const replyToId = optionalString(body, "replyToId") ?? null;
    const attachmentId = optionalString(body, "attachmentId") ?? null;
    const clientOperationId = optionalString(body, "clientOperationId", {
      minLength: 1,
      maxLength: 128,
      pattern: /^[a-zA-Z0-9_-]+$/,
    }) ?? null;
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.runtimePolicy?.requireChannelMutation(conversationId);

    const room = this.roomRepository.findById(conversationId);
    const audienceUserIds = room
      ? roomAudienceUserIds(room, this.connectionManager, this.roomMemberRepository)
      : [];
    const outcome = (this.transactions ?? { run: <T>(fn: () => T): T => fn() }).run(() => {
      const sent = this.messageService.sendIdempotent(
        ctx.userId,
        conversationId,
        content,
        replyToId,
        attachmentId,
        clientOperationId,
      );
      const triggers = room && sent.created
        ? this.notificationService.notifyForNewMessage(room, sent.message, audienceUserIds)
        : [];
      return { ...sent, triggers };
    });

    if (room && outcome.created) {
      pushToRoomAudience(
        room,
        this.codec.encode(outboundPush("message.new", { message: outcome.message })),
        this.connectionManager,
        this.roomMemberRepository,
      );
      for (const userId of audienceUserIds) {
        if (userId === ctx.userId) continue;
        const count = this.roomReadService.countUnread(conversationId, userId);
        this.connectionManager.sendToUser(
          userId,
          this.codec.encode(outboundPush("unread.updated", { conversationId, count })),
        );
      }

      for (const trigger of outcome.triggers) {
        this.connectionManager.sendToUser(
          trigger.userId,
          this.codec.encode(
            outboundPush("notification.new", { notification: trigger.notification }),
          ),
        );
      }
    }

    return { message: outcome.message, replayed: !outcome.created };
  }
}
