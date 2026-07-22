import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { openDatabase } from "../../src/storage/db.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

Deno.test("migration 0013 upgrades a migration-0012 database without changing legacy messages", async () => {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-message-operation-upgrade-" });
  const oldMigrations = `${dir}/migrations`;
  const path = `${dir}/upgrade.sqlite`;
  await Deno.mkdir(oldMigrations);
  try {
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".sql") || entry.name >= "0013") continue;
      await Deno.copyFile(`${MIGRATIONS_DIR}/${entry.name}`, `${oldMigrations}/${entry.name}`);
    }
    const before = await openDatabase(path, oldMigrations, createLogger("error", "message-op-old"));
    before.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("author-a", "authora", "Author A", "author-a@example.com", "hash");
    before.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("author-b", "authorb", "Author B", "author-b@example.com", "hash");
    before.prepare(
      "INSERT INTO conversations (id,type,name,owner_id,is_public) VALUES (?,?,?,?,?)",
    ).run("conversation", "group", "Upgrade", "author-a", 0);
    before.prepare(
      "INSERT INTO conversation_memberships (conversation_id,user_id,role) VALUES (?,?,?)",
    ).run("conversation", "author-a", "owner");
    before.prepare("INSERT INTO messages (id,conversation_id,author_id,content) VALUES (?,?,?,?)")
      .run(
        "legacy-message",
        "conversation",
        "author-a",
        "legacy content",
      );
    const oldColumns = before.prepare("PRAGMA table_info(messages)").all() as Array<
      { name: string }
    >;
    assertEquals(oldColumns.some((column) => column.name === "client_operation_id"), false);
    assertEquals(
      (before.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
        version: number;
      })
        .version,
      12,
    );
    before.close();

    const upgraded = await openDatabase(
      path,
      MIGRATIONS_DIR,
      createLogger("error", "message-op-upgraded"),
    );
    try {
      const legacy = upgraded.prepare(
        "SELECT content, client_operation_id FROM messages WHERE id = ?",
      ).get("legacy-message") as { content: string; client_operation_id: string | null };
      assertEquals(legacy, { content: "legacy content", client_operation_id: null });
      const index = upgraded.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
      ).get("idx_messages_author_client_operation") as { sql: string };
      assertEquals(index.sql.includes("WHERE client_operation_id IS NOT NULL"), true);

      upgraded.prepare(
        "INSERT INTO messages (id,conversation_id,author_id,content,client_operation_id) VALUES (?,?,?,?,?)",
      ).run("operation-a", "conversation", "author-a", "first", "operation-1");
      assertThrows(() => {
        upgraded.prepare(
          "INSERT INTO messages (id,conversation_id,author_id,content,client_operation_id) VALUES (?,?,?,?,?)",
        ).run("operation-a-duplicate", "conversation", "author-a", "duplicate", "operation-1");
      });
      upgraded.prepare(
        "INSERT INTO messages (id,conversation_id,author_id,content,client_operation_id) VALUES (?,?,?,?,?)",
      ).run("operation-b", "conversation", "author-b", "other author", "operation-1");
      upgraded.prepare(
        "INSERT INTO messages (id,conversation_id,author_id,content,client_operation_id) VALUES (?,?,?,?,?)",
      ).run("legacy-null-a", "conversation", "author-a", "legacy null a", null);
      upgraded.prepare(
        "INSERT INTO messages (id,conversation_id,author_id,content,client_operation_id) VALUES (?,?,?,?,?)",
      ).run("legacy-null-b", "conversation", "author-a", "legacy null b", null);

      assertEquals(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
      assertEquals(
        (upgraded.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check,
        "ok",
      );
      assertEquals(
        (upgraded.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 13")
          .get() as {
            count: number;
          }).count,
        1,
      );
    } finally {
      upgraded.close();
    }

    const reopened = await openDatabase(
      path,
      MIGRATIONS_DIR,
      createLogger("error", "message-op-reopened"),
    );
    try {
      assertEquals(
        (reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 13")
          .get() as {
            count: number;
          }).count,
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
