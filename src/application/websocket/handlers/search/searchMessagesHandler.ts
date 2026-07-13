import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { SearchService } from "../../../../domain/search/searchService.ts";
import type { MessageSummary } from "../../../../domain/messages/message.entity.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Search" — `search.messages`. */
export class SearchMessagesHandler implements EventHandler {
  readonly event = "search.messages";

  constructor(private readonly searchService: SearchService) {}

  handle(ctx: HandlerContext, data: unknown): { messages: MessageSummary[] } {
    const body = asRecord(data, "search.messages data");
    const conversationId = requireString(body, "conversationId");
    const query = requireString(body, "query", { minLength: 1, maxLength: 200 });

    return { messages: this.searchService.searchMessages(ctx.userId, conversationId, query) };
  }
}
