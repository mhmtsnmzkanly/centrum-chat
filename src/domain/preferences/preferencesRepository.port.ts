import type { Preferences } from "./preferences.entity.ts";

export interface PreferencesUpdate {
  readonly sound?: boolean;
  readonly desktopNotifications?: boolean;
  readonly dmPrivacy?: Preferences["dmPrivacy"];
  readonly groupPrivacy?: Preferences["groupPrivacy"];
  readonly theme?: Preferences["theme"];
}

/** Port implemented by `storage/repositories/sqlitePreferencesRepository.ts`. No row
 * exists in `user_preferences` until first accessed — both methods lazily create one
 * with the schema's defaults so callers never see a "not found" for preferences. */
export interface PreferencesRepository {
  getOrCreate(userId: string): Preferences;
  update(userId: string, patch: PreferencesUpdate): Preferences;
}
