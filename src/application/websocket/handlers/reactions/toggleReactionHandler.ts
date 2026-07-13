import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { ReactionService } from "../../../../domain/reactions/reactionService.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "../../../../domain/conversations/conversationMembershipRepository.port.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import type { ReactionSummary } from "../../../../domain/messages/message.entity.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { pushToRoomAudience } from "../../conversationFanout.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";

// A reaction must be an actual emoji sequence (pictographic characters, skin-tone/keycap
// components, regional-indicator flag pairs, ZWJ joins, and variation selectors) — never
// arbitrary text. This keeps HTML metacharacters out of the stored value, since the
// reaction emoji is echoed into a hand-built innerHTML in the web client
// (web/index.js showReactionUsersPopover) outside the escape-by-default template path.
const EMOJI_PATTERN =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|\u200D|\uFE0F)+$/u;

/** docs/03-websocket-events.md "Module: Reactions" — `reaction.toggle`. */
export class ToggleReactionHandler implements EventHandler {
  readonly event = "reaction.toggle";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly reactionService: ReactionService,
    private readonly roomRepository: ConversationRepository,
    private readonly roomMemberRepository: ConversationMembershipRepository,
    private readonly notificationService: NotificationService,
    private readonly rateLimiter: RateLimiter,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly runtimePolicy?: RuntimePolicy,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): { reactions: ReactionSummary[] } {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.sanctionPolicy?.requireCanMessage(ctx.userId);
    this.runtimePolicy?.requireMutation(ctx.userId);
    const body = asRecord(data, "reaction.toggle data");
    const messageId = requireString(body, "messageId");
    const emoji = requireString(body, "emoji", {
      minLength: 1,
      maxLength: 8,
      pattern: EMOJI_PATTERN,
    });

    const result = this.reactionService.toggle(ctx.userId, messageId, emoji);

    const room = this.roomRepository.findById(result.conversationId);
    if (room) this.runtimePolicy?.requireChannelMutation(room.id);
    if (room) {
      pushToRoomAudience(
        room,
        this.codec.encode(
          outboundPush("reaction.updated", { messageId, reactions: result.reactions }),
        ),
        this.connectionManager,
        this.roomMemberRepository,
      );
    }

    if (result.added) {
      const trigger = this.notificationService.notifyReaction(
        result.messageAuthorId,
        ctx.userId,
        result.conversationId,
        messageId,
      );
      if (trigger) {
        this.connectionManager.sendToUser(
          trigger.userId,
          this.codec.encode(
            outboundPush("notification.new", { notification: trigger.notification }),
          ),
        );
      }
    }

    return { reactions: result.reactions };
  }
}
