import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";

Deno.test("SqlitePreferencesRepository: getOrCreate lazily creates a default row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqlitePreferencesRepository(db);

    const prefs = repo.getOrCreate("u-1");
    assertEquals(prefs, {
      sound: true,
      desktopNotifications: false,
      dmPrivacy: "everyone",
      groupPrivacy: "everyone",
      theme: "dark",
      locale: null,
    });

    // calling it again doesn't clobber anything (INSERT OR IGNORE)
    assertEquals(repo.getOrCreate("u-1"), prefs);
  } finally {
    await cleanup();
  }
});

Deno.test("SqlitePreferencesRepository: update applies a partial patch, creating the row if needed", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqlitePreferencesRepository(db);

    const updated = repo.update("u-1", { theme: "light", sound: false });
    assertEquals(updated.theme, "light");
    assertEquals(updated.sound, false);
    assertEquals(updated.dmPrivacy, "everyone"); // untouched field keeps its default

    const updatedAgain = repo.update("u-1", { dmPrivacy: "no_one" });
    assertEquals(updatedAgain.theme, "light"); // still untouched by this second patch
    assertEquals(updatedAgain.dmPrivacy, "no_one");

    const localized = repo.update("u-1", { locale: "tr" });
    assertEquals(localized.locale, "tr");
    assertEquals(repo.getOrCreate("u-1").locale, "tr");
  } finally {
    await cleanup();
  }
});
