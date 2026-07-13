import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.list`. */
export class ListGroupsHandler implements EventHandler {
  readonly event = "group.list";

  constructor(private readonly groupService: GroupService) {}

  handle(ctx: HandlerContext, _data: unknown): { groups: ConversationSummary[] } {
    return { groups: this.groupService.listGroups(ctx.userId) };
  }
}
