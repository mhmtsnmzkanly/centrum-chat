import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { MessageService } from "../../../../domain/messages/messageService.ts";
import type { MessageSummary } from "../../../../domain/messages/message.entity.ts";
import {
  asRecord,
  optionalInteger,
  optionalString,
  requireString,
} from "../../../../shared/validation/validator.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** docs/03-websocket-events.md "Module: Messages" — `message.history`. */
export class MessageHistoryHandler implements EventHandler {
  readonly event = "message.history";

  constructor(private readonly messageService: MessageService) {}

  handle(
    ctx: HandlerContext,
    data: unknown,
  ): { messages: MessageSummary[]; hasMore: boolean } {
    const body = asRecord(data, "message.history data");
    const conversationId = requireString(body, "conversationId");
    const before = optionalString(body, "before") ?? null;
    const requestedLimit = optionalInteger(body, "limit", { min: 1 }) ?? DEFAULT_LIMIT;
    const limit = Math.min(requestedLimit, MAX_LIMIT);

    return this.messageService.history(ctx.userId, conversationId, before, limit);
  }
}
