import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { UserService } from "../../../../domain/users/userService.ts";
import type { ProfileUpdate } from "../../../../domain/users/userRepository.port.ts";
import type { Profile } from "../../../../domain/users/user.entity.ts";
import {
  asRecord,
  optionalBoolean,
  optionalInteger,
  optionalString,
} from "../../../../shared/validation/validator.ts";

const NAME_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** docs/03-websocket-events.md "Module: Profile / Preferences" — `profile.update`, self only. */
export class UpdateProfileHandler implements EventHandler {
  readonly event = "profile.update";

  constructor(private readonly userService: UserService) {}

  handle(ctx: HandlerContext, data: unknown): { profile: Profile } {
    const body = asRecord(data, "profile.update data");
    const displayName = optionalString(body, "displayName", { minLength: 1, maxLength: 50 });
    const bio = optionalString(body, "bio", { maxLength: 280 });
    const avatarSeed = optionalString(body, "avatarSeed", { maxLength: 100 });
    const nameColor = optionalString(body, "nameColor", { pattern: NAME_COLOR_PATTERN });
    const coverIndex = optionalInteger(body, "coverIndex", { min: 0 });
    const isPremium = optionalBoolean(body, "isPremium");

    const patch: ProfileUpdate = {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(avatarSeed !== undefined ? { avatarSeed } : {}),
      ...(nameColor !== undefined ? { nameColor } : {}),
      ...(coverIndex !== undefined ? { coverIndex } : {}),
      ...(isPremium !== undefined ? { isPremium } : {}),
    };

    return { profile: this.userService.updateProfile(ctx.userId, patch) };
  }
}
