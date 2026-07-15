import { assertEquals } from "jsr:@std/assert@1";
import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { createTestDb } from "../support/testDatabase.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

Deno.test("onboarding migration leaves new users incomplete and fresh database integrity is valid", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    db.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("new-user", "new_user", "New User", "new@example.com", "hash");
    const row = db.prepare(
      "SELECT onboarding_preferences_completed_at AS completed_at FROM users WHERE id = ?",
    ).get("new-user") as { completed_at: string | null };
    assertEquals(row.completed_at, null);
    assertEquals(db.prepare("PRAGMA foreign_key_check").all(), []);
    assertEquals(
      (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check,
      "ok",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("onboarding migration backfills users upgrading from migration 0010", async () => {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-onboarding-upgrade-" });
  const oldMigrations = `${dir}/migrations`;
  const path = `${dir}/upgrade.sqlite`;
  await Deno.mkdir(oldMigrations);
  try {
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".sql") || entry.name >= "0011") continue;
      await Deno.copyFile(`${MIGRATIONS_DIR}/${entry.name}`, `${oldMigrations}/${entry.name}`);
    }
    const oldDb = await openDatabase(path, oldMigrations, createLogger("error", "onboarding-old"));
    oldDb.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("existing", "existing", "Existing", "existing@example.com", "hash");
    const createdAt = (oldDb.prepare("SELECT created_at FROM users WHERE id='existing'").get() as {
      created_at: string;
    }).created_at;
    oldDb.close();

    const upgraded = await openDatabase(
      path,
      MIGRATIONS_DIR,
      createLogger("error", "onboarding-upgraded"),
    );
    try {
      const completedAt = (upgraded.prepare(
        "SELECT onboarding_preferences_completed_at AS completed_at FROM users WHERE id='existing'",
      ).get() as { completed_at: string }).completed_at;
      assertEquals(completedAt, createdAt);
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
