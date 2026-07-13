import { type Db, withTransaction } from "../db.ts";
import type { Preferences } from "../../domain/preferences/preferences.entity.ts";
import type {
  PreferencesRepository,
  PreferencesUpdate,
} from "../../domain/preferences/preferencesRepository.port.ts";

interface PreferencesRow {
  user_id: string;
  sound_enabled: number;
  desktop_notifications: number;
  dm_privacy: string;
  group_privacy: string;
  theme: string;
}

function toPreferences(row: PreferencesRow): Preferences {
  return {
    sound: row.sound_enabled === 1,
    desktopNotifications: row.desktop_notifications === 1,
    dmPrivacy: row.dm_privacy as Preferences["dmPrivacy"],
    groupPrivacy: row.group_privacy as Preferences["groupPrivacy"],
    theme: row.theme as Preferences["theme"],
  };
}

/** All SQL for `user_preferences` lives here — no SQL outside `storage/repositories/**`. */
export class SqlitePreferencesRepository implements PreferencesRepository {
  constructor(private readonly db: Db) {}

  getOrCreate(userId: string): Preferences {
    this.db.prepare("INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)").run(userId);
    const row = this.db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(
      userId,
    ) as PreferencesRow | undefined;
    if (!row) throw new Error("Failed to read back preferences row.");
    return toPreferences(row);
  }

  update(userId: string, patch: PreferencesUpdate): Preferences {
    return withTransaction(this.db, (db) => {
      db.prepare("INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)").run(userId);
      db.prepare(
        `UPDATE user_preferences SET
           sound_enabled = COALESCE(?, sound_enabled),
           desktop_notifications = COALESCE(?, desktop_notifications),
           dm_privacy = COALESCE(?, dm_privacy),
           group_privacy = COALESCE(?, group_privacy),
           theme = COALESCE(?, theme)
         WHERE user_id = ?`,
      ).run(
        patch.sound === undefined ? null : Number(patch.sound),
        patch.desktopNotifications === undefined ? null : Number(patch.desktopNotifications),
        patch.dmPrivacy ?? null,
        patch.groupPrivacy ?? null,
        patch.theme ?? null,
        userId,
      );

      const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(
        userId,
      ) as PreferencesRow | undefined;
      if (!row) throw new Error("Failed to read back updated preferences row.");
      return toPreferences(row);
    });
  }
}
