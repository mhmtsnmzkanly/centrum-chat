import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { PreferencesService } from "../../../../domain/preferences/preferencesService.ts";
import type {
  DmPrivacy,
  GroupPrivacy,
  Preferences,
  Theme,
} from "../../../../domain/preferences/preferences.entity.ts";
import type { PreferencesUpdate } from "../../../../domain/preferences/preferencesRepository.port.ts";
import {
  asRecord,
  optionalBoolean,
  optionalEnum,
} from "../../../../shared/validation/validator.ts";

const DM_PRIVACY_VALUES: readonly DmPrivacy[] = ["everyone", "group_members", "no_one"];
const GROUP_PRIVACY_VALUES: readonly GroupPrivacy[] = ["everyone", "dm_contacts", "no_one"];
const THEME_VALUES: readonly Theme[] = ["dark", "light"];

/** docs/03-websocket-events.md "Module: Profile / Preferences" — `preferences.update`. */
export class UpdatePreferencesHandler implements EventHandler {
  readonly event = "preferences.update";

  constructor(private readonly preferencesService: PreferencesService) {}

  handle(ctx: HandlerContext, data: unknown): { preferences: Preferences } {
    const body = asRecord(data, "preferences.update data");
    const sound = optionalBoolean(body, "sound");
    const desktopNotifications = optionalBoolean(body, "desktopNotifications");
    const dmPrivacy = optionalEnum(body, "dmPrivacy", DM_PRIVACY_VALUES);
    const groupPrivacy = optionalEnum(body, "groupPrivacy", GROUP_PRIVACY_VALUES);
    const theme = optionalEnum(body, "theme", THEME_VALUES);

    const patch: PreferencesUpdate = {
      ...(sound !== undefined ? { sound } : {}),
      ...(desktopNotifications !== undefined ? { desktopNotifications } : {}),
      ...(dmPrivacy !== undefined ? { dmPrivacy } : {}),
      ...(groupPrivacy !== undefined ? { groupPrivacy } : {}),
      ...(theme !== undefined ? { theme } : {}),
    };

    return { preferences: this.preferencesService.update(ctx.userId, patch) };
  }
}
