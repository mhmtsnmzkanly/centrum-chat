import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { DmService } from "../../../../domain/conversations/dmService.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import { requireRateLimit } from "../../rateLimitGuard.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Direct Messages" — `dm.open`. */
export class OpenDmHandler implements EventHandler {
  readonly event = "dm.open";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly dmService: DmService,
    private readonly rateLimiter: RateLimiter,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): { room: ConversationSummary } {
    requireRateLimit(this.rateLimiter, this.event, ctx.userId);
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    const body = asRecord(data, "dm.open data");
    const userId = requireString(body, "userId");

    return { room: this.dmService.openDm(ctx.userId, userId) };
  }
}
