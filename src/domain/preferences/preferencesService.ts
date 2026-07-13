import type { PreferencesRepository, PreferencesUpdate } from "./preferencesRepository.port.ts";
import type { Preferences } from "./preferences.entity.ts";

/** docs/03-websocket-events.md "Module: Profile / Preferences" (preferences.get/update). */
export class PreferencesService {
  constructor(private readonly preferences: PreferencesRepository) {}

  get(userId: string): Preferences {
    return this.preferences.getOrCreate(userId);
  }

  update(userId: string, patch: PreferencesUpdate): Preferences {
    return this.preferences.update(userId, patch);
  }
}
