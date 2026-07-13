import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { UserService } from "../../../../domain/users/userService.ts";
import type { Profile } from "../../../../domain/users/user.entity.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import type { BlockPolicy } from "../../../../domain/safety/safetyPolicy.ts";

/** docs/03-websocket-events.md "Module: Profile / Preferences" — `profile.get`. */
export class GetProfileHandler implements EventHandler {
  readonly event = "profile.get";

  constructor(
    private readonly userService: UserService,
    private readonly blockPolicy?: BlockPolicy,
  ) {}

  handle(ctx: HandlerContext, data: unknown): { profile: Profile } {
    const body = asRecord(data, "profile.get data");
    const userId = requireString(body, "userId");
    if (userId !== ctx.userId) this.blockPolicy?.requireDirectInteraction(ctx.userId, userId);
    return { profile: this.userService.getProfile(userId) };
  }
}
