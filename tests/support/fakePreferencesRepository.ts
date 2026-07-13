import type { Preferences } from "../../src/domain/preferences/preferences.entity.ts";
import type {
  PreferencesRepository,
  PreferencesUpdate,
} from "../../src/domain/preferences/preferencesRepository.port.ts";

export const DEFAULT_PREFERENCES: Preferences = {
  sound: true,
  desktopNotifications: false,
  dmPrivacy: "everyone",
  groupPrivacy: "everyone",
  theme: "dark",
};

/** In-memory fake PreferencesRepository — unit tests exercise domain services against
 * fake repos (docs/05-folder-structure.md tests/unit convention), not real SQLite. */
export class FakePreferencesRepository implements PreferencesRepository {
  private readonly byUserId = new Map<string, Preferences>();

  getOrCreate(userId: string): Preferences {
    const existing = this.byUserId.get(userId);
    if (existing) return existing;
    this.byUserId.set(userId, DEFAULT_PREFERENCES);
    return DEFAULT_PREFERENCES;
  }

  update(userId: string, patch: PreferencesUpdate): Preferences {
    const current = this.getOrCreate(userId);
    const updated = { ...current, ...patch };
    this.byUserId.set(userId, updated);
    return updated;
  }
}
