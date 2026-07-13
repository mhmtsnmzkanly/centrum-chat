import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { GroupService } from "../../../../domain/conversations/groupService.ts";
import type { UserSummary } from "../../../../domain/users/user.entity.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Groups" — `group.members`. */
export class GroupMembersHandler implements EventHandler {
  readonly event = "group.members";

  constructor(private readonly groupService: GroupService) {}

  handle(ctx: HandlerContext, data: unknown): { members: UserSummary[] } {
    const body = asRecord(data, "group.members data");
    const groupId = requireString(body, "groupId");
    const members = this.groupService.getMembers(ctx.userId, groupId);
    return { members };
  }
}
