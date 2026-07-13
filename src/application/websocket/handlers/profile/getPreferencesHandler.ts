import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { PreferencesService } from "../../../../domain/preferences/preferencesService.ts";
import type { Preferences } from "../../../../domain/preferences/preferences.entity.ts";

/** docs/03-websocket-events.md "Module: Profile / Preferences" — `preferences.get`. */
export class GetPreferencesHandler implements EventHandler {
  readonly event = "preferences.get";

  constructor(private readonly preferencesService: PreferencesService) {}

  handle(ctx: HandlerContext, _data: unknown): { preferences: Preferences } {
    return { preferences: this.preferencesService.get(ctx.userId) };
  }
}
