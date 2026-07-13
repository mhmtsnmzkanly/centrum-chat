import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { DmService } from "../../../../domain/conversations/dmService.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";

/** docs/03-websocket-events.md "Module: Direct Messages" — `dm.list`. */
export class ListDmHandler implements EventHandler {
  readonly event = "dm.list";

  constructor(private readonly dmService: DmService) {}

  handle(ctx: HandlerContext, _data: unknown): { rooms: ConversationSummary[] } {
    return { rooms: this.dmService.listDms(ctx.userId) };
  }
}
