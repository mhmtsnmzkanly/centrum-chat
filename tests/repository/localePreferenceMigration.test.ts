import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

Deno.test("locale preference defaults to unset and enforces the supported catalog set", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "new-user",
      username: "new_user",
      displayName: "New User",
      email: "new@example.com",
      passwordHash: "hash",
    });
    const preferences = new SqlitePreferencesRepository(db);

    assertEquals(preferences.getOrCreate("new-user").locale, null);
    assertEquals(preferences.update("new-user", { locale: "tr" }).locale, "tr");
    assertThrows(() => {
      db.prepare("UPDATE user_preferences SET locale = 'fr' WHERE user_id = 'new-user'").run();
    });
    assertEquals(db.prepare("PRAGMA foreign_key_check").all(), []);
    assertEquals(
      (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check,
      "ok",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("migration 0012 preserves existing preferences and leaves locale unset", async () => {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-locale-upgrade-" });
  const oldMigrations = `${dir}/migrations`;
  const path = `${dir}/upgrade.sqlite`;
  await Deno.mkdir(oldMigrations);
  try {
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".sql") || entry.name >= "0012") continue;
      await Deno.copyFile(`${MIGRATIONS_DIR}/${entry.name}`, `${oldMigrations}/${entry.name}`);
    }
    const oldDb = await openDatabase(path, oldMigrations, createLogger("error", "locale-old"));
    oldDb.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("existing", "existing", "Existing", "existing@example.com", "hash");
    oldDb.prepare(
      "INSERT INTO user_preferences (user_id, sound_enabled, theme) VALUES (?, ?, ?)",
    ).run("existing", 0, "light");
    oldDb.close();

    const upgraded = await openDatabase(
      path,
      MIGRATIONS_DIR,
      createLogger("error", "locale-upgraded"),
    );
    try {
      const row = upgraded.prepare(
        "SELECT sound_enabled, theme, locale FROM user_preferences WHERE user_id = ?",
      ).get("existing") as { sound_enabled: number; theme: string; locale: string | null };
      assertEquals(row, { sound_enabled: 0, theme: "light", locale: null });
      assertEquals(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
      assertEquals(
        (upgraded.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check,
        "ok",
      );
    } finally {
      upgraded.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
