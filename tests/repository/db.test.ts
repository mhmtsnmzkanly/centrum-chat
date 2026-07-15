import { DatabaseSync } from "node:sqlite";
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { createLegacyDatabase } from "../support/legacyDatabase.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

Deno.test("fresh databases apply every migration and expose the renamed schema", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = rows.map((row) => row.name);

    assertEquals(tableNames, [
      "attachments",
      "conversation_memberships",
      "conversation_reads",
      "conversations",
      "direct_conversation_pairs",
      "email_change_tokens",
      "email_verification_tokens",
      "messages",
      "notifications",
      "password_reset_tokens",
      "reactions",
      "reports",
      "schema_migrations",
      "security_audit_events",
      "system_settings",
      "user_blocks",
      "user_preferences",
      "user_sanctions",
      "user_sessions",
      "users",
    ]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    assertEquals(indexRows.map((row) => row.name), [
      "idx_attachments_message",
      "idx_attachments_uploader",
      "idx_conversation_memberships_user",
      "idx_conversation_reads_user",
      "idx_conversations_channel_admin",
      "idx_email_change_tokens_expires",
      "idx_email_change_tokens_user",
      "idx_email_verification_tokens_expires",
      "idx_email_verification_tokens_user",
      "idx_messages_conversation_created",
      "idx_messages_reply_to",
      "idx_notifications_user_unread",
      "idx_password_reset_tokens_expires",
      "idx_password_reset_tokens_user",
      "idx_reactions_message",
      "idx_reports_active_attachment_unique",
      "idx_reports_active_message_unique",
      "idx_reports_active_user_unique",
      "idx_reports_assignee",
      "idx_reports_queue",
      "idx_security_audit_action",
      "idx_security_audit_actor",
      "idx_security_audit_created",
      "idx_user_blocks_blocked",
      "idx_user_sanctions_active",
      "idx_user_sanctions_created",
      "idx_user_sessions_user",
      "idx_users_system_role",
    ]);

    const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    assertEquals(userColumns.some((column) => column.name === "email_verified_at"), true);
    assertEquals(userColumns.some((column) => column.name === "app_role"), true);
    assertEquals(userColumns.some((column) => column.name === "system_role"), true);
    assertEquals(userColumns.some((column) => column.name === "must_reset_password"), true);
    assertEquals(
      userColumns.some((column) => column.name === "onboarding_preferences_completed_at"),
      true,
    );

    const sessionColumns = db.prepare("PRAGMA table_info(user_sessions)").all() as Array<
      { name: string }
    >;
    assertEquals(sessionColumns.some((column) => column.name === "remembered"), true);
    assertEquals(sessionColumns.some((column) => column.name === "last_used_at"), true);
    assertEquals(sessionColumns.some((column) => column.name === "ip_address"), true);
    assertEquals(sessionColumns.some((column) => column.name === "user_agent"), true);

    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    assertEquals(fkCheck, []);
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    assertEquals(integrity.integrity_check, "ok");

    const migrationCount = db
      .prepare("SELECT COUNT(*) as count FROM schema_migrations")
      .get() as { count: number };
    assertEquals(migrationCount.count, 11);
    assertEquals(
      db.prepare(
        "SELECT name FROM sqlite_schema WHERE type='trigger' AND name='reports_validate_target_insert'",
      ).get(),
      { name: "reports_validate_target_insert" },
    );
  } finally {
    await cleanup();
  }
});

Deno.test("migration 0008 preserves account-security and chat data from a 0007 database", async () => {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-migration-0008-" });
  const migrationDir = `${dir}/migrations`;
  const path = `${dir}/database.sqlite`;
  await Deno.mkdir(migrationDir);
  try {
    for (let version = 1; version <= 7; version++) {
      const prefix = String(version).padStart(4, "0") + "_";
      for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
        if (entry.isFile && entry.name.startsWith(prefix)) {
          await Deno.copyFile(`${MIGRATIONS_DIR}/${entry.name}`, `${migrationDir}/${entry.name}`);
        }
      }
    }

    const logger = createLogger("error", "test-db-0008");
    const before = await openDatabase(path, migrationDir, logger);
    before.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
    ).run("user-1", "user1", "User One", "user1@example.com", "hash");
    before.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(
      "2026-01-01T00:00:00.000Z",
      "user-1",
    );
    before.prepare(
      "INSERT INTO user_sessions (id,user_id,refresh_token_hash,device_label,issued_at,expires_at,remembered,last_used_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      "session-1",
      "user-1",
      "refresh-hash",
      "Browser",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      1,
      "2026-01-01T01:00:00.000Z",
    );
    before.prepare(
      "INSERT INTO conversations (id,type,name,owner_id,is_public) VALUES (?,?,?,?,?)",
    ).run("conversation-1", "group", "Group", "user-1", 0);
    before.prepare(
      "INSERT INTO conversation_memberships (conversation_id,user_id,role) VALUES (?,?,?)",
    ).run("conversation-1", "user-1", "owner");
    before.prepare(
      "INSERT INTO messages (id,conversation_id,author_id,content) VALUES (?,?,?,?)",
    ).run("message-1", "conversation-1", "user-1", "preserved");
    before.prepare(
      "INSERT INTO attachments (id,message_id,file_name,mime_type,size_bytes,storage_path,kind,uploader_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      "attachment-1",
      "message-1",
      "file.txt",
      "text/plain",
      9,
      "aa/file.txt",
      "attachment",
      "user-1",
    );
    before.prepare(
      "INSERT INTO email_verification_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)",
    ).run("verification-1", "user-1", "verification-hash", "2026-01-01T02:00:00.000Z");
    before.close();

    await Deno.copyFile(
      `${MIGRATIONS_DIR}/0008_user_safety_moderation_and_captcha.sql`,
      `${migrationDir}/0008_user_safety_moderation_and_captcha.sql`,
    );
    const after = await openDatabase(path, migrationDir, logger);
    try {
      for (
        const [table, id] of [
          ["users", "user-1"],
          ["user_sessions", "session-1"],
          ["conversations", "conversation-1"],
          ["messages", "message-1"],
          ["attachments", "attachment-1"],
          ["email_verification_tokens", "verification-1"],
        ] as const
      ) {
        assertEquals(
          after.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id),
          { id },
        );
      }
      const migratedUser = after.prepare(
        "SELECT app_role,email_verified_at FROM users WHERE id='user-1'",
      ).get() as { app_role: string; email_verified_at: string | null };
      assertEquals(migratedUser.app_role, "user");
      assertEquals(migratedUser.email_verified_at, "2026-01-01T00:00:00.000Z");
      assertEquals(after.prepare("PRAGMA foreign_key_check").all(), []);
      assertEquals(
        (after.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check,
        "ok",
      );
    } finally {
      after.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migration 0009 preserves migration-0008 data and enforces administration constraints", async () => {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-migration-0009-" });
  const migrationDir = `${dir}/migrations`;
  const path = `${dir}/database.sqlite`;
  await Deno.mkdir(migrationDir);
  try {
    for (let version = 1; version <= 8; version++) {
      const prefix = String(version).padStart(4, "0") + "_";
      for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
        if (entry.isFile && entry.name.startsWith(prefix)) {
          await Deno.copyFile(`${MIGRATIONS_DIR}/${entry.name}`, `${migrationDir}/${entry.name}`);
        }
      }
    }
    const logger = createLogger("error", "test-db-0009");
    const before = await openDatabase(path, migrationDir, logger);
    before.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash,app_role,email_verified_at) VALUES (?,?,?,?,?,'admin',?)",
    ).run("owner", "owner", "Owner", "owner@example.com", "hash", "2026-01-01T00:00:00.000Z");
    before.prepare(
      "INSERT INTO users (id,username,display_name,email,password_hash,email_verified_at) VALUES (?,?,?,?,?,?)",
    ).run("user", "user", "User", "user@example.com", "hash", "2026-01-01T00:00:00.000Z");
    before.prepare(
      "INSERT INTO user_sessions (id,user_id,refresh_token_hash,expires_at) VALUES (?,?,?,?)",
    ).run("session", "user", "session-hash", "2027-01-01T00:00:00.000Z");
    before.prepare(
      "INSERT INTO conversations (id,type,name,owner_id,is_public) VALUES (?,'group',?,?,0)",
    ).run("conversation", "Preserved", "user");
    before.prepare(
      "INSERT INTO conversation_memberships (conversation_id,user_id,role) VALUES (?,?,'owner')",
    ).run("conversation", "user");
    before.prepare(
      "INSERT INTO messages (id,conversation_id,author_id,content) VALUES (?,?,?,?)",
    ).run("message", "conversation", "user", "preserved");
    before.prepare(
      "INSERT INTO reports (id,reporter_user_id,target_type,target_reference_id,target_user_id,reason_code) VALUES (?,?,'user',?,?,'spam')",
    ).run("report", "owner", "user", "user");
    before.prepare(
      "INSERT INTO user_sanctions (id,user_id,sanction_type,reason_code,created_by_user_id,starts_at,expires_at) VALUES (?,?,'message_mute','spam',?,?,?)",
    ).run(
      "sanction",
      "user",
      "owner",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );
    before.prepare(
      "INSERT INTO security_audit_events (id,actor_user_id,actor_type,action_code,outcome) VALUES (?,?,'admin',?,'success')",
    ).run("audit", "owner", "sanction.apply");
    before.close();

    await Deno.copyFile(
      `${MIGRATIONS_DIR}/0009_backend_administration.sql`,
      `${migrationDir}/0009_backend_administration.sql`,
    );
    const after = await openDatabase(path, migrationDir, logger);
    try {
      for (
        const [table, id] of [
          ["users", "user"],
          ["user_sessions", "session"],
          ["conversations", "conversation"],
          ["messages", "message"],
          ["reports", "report"],
          ["user_sanctions", "sanction"],
          ["security_audit_events", "audit"],
        ] as const
      ) {
        assertEquals(after.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id), { id });
      }
      assertEquals(after.prepare("SELECT system_role FROM users WHERE id='owner'").get(), {
        system_role: "owner",
      });
      assertEquals(
        (after.prepare("SELECT COUNT(*) count FROM system_settings").get() as { count: number })
          .count,
        11,
      );
      assertThrows(() =>
        after.prepare(
          "INSERT INTO system_settings (key,value_json,value_type) VALUES ('jwt_secret','\"bad\"','string')",
        ).run()
      );
      assertThrows(() =>
        after.prepare("UPDATE users SET system_role='admin' WHERE id='owner'").run()
      );
      assertEquals(after.prepare("PRAGMA foreign_key_check").all(), []);
      assertEquals(
        (after.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
          .integrity_check,
        "ok",
      );
    } finally {
      after.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("existing databases on the legacy schema migrate in place without losing rows", async () => {
  const { path, cleanup: cleanupCopy } = await createLegacyDatabase();
  const logger = createLogger("error", "test-db-legacy");
  try {
    let preDmIds: { id: string }[] = [];
    let preMessageCount = 0;
    const preMigrationDb = new DatabaseSync(path);
    try {
      const preTables = preMigrationDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      assertEquals(preTables.some((row) => row.name === "rooms"), true);
      assertEquals(preTables.some((row) => row.name === "room_members"), true);
      assertEquals(preTables.some((row) => row.name === "room_reads"), true);
      assertEquals(preTables.some((row) => row.name === "refresh_tokens"), true);

      const preChannels = preMigrationDb
        .prepare("SELECT id, slug FROM rooms WHERE type = 'channel' ORDER BY slug")
        .all() as { id: string; slug: string }[];
      assertEquals(preChannels.map((row) => row.slug), [
        "gaming",
        "general",
        "programming",
        "technology",
      ]);
      preDmIds = preMigrationDb
        .prepare("SELECT id FROM rooms WHERE type = 'dm' ORDER BY id")
        .all() as { id: string }[];
      preMessageCount = (
        preMigrationDb.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }
      ).count;
    } finally {
      preMigrationDb.close();
    }

    const migrated = await openDatabase(path, MIGRATIONS_DIR, logger);
    try {
      const postTables = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      assertEquals(postTables.some((row) => row.name === "rooms"), false);
      assertEquals(postTables.some((row) => row.name === "room_members"), false);
      assertEquals(postTables.some((row) => row.name === "room_reads"), false);
      assertEquals(postTables.some((row) => row.name === "refresh_tokens"), false);
      assertEquals(postTables.some((row) => row.name === "conversations"), true);
      assertEquals(postTables.some((row) => row.name === "conversation_memberships"), true);
      assertEquals(postTables.some((row) => row.name === "conversation_reads"), true);
      assertEquals(postTables.some((row) => row.name === "user_sessions"), true);
      assertEquals(postTables.some((row) => row.name === "direct_conversation_pairs"), true);
      assertEquals(postTables.some((row) => row.name === "email_verification_tokens"), true);
      assertEquals(postTables.some((row) => row.name === "password_reset_tokens"), true);
      assertEquals(postTables.some((row) => row.name === "email_change_tokens"), true);

      const postChannels = migrated
        .prepare("SELECT id, slug FROM conversations WHERE type = 'channel' ORDER BY slug")
        .all() as { id: string; slug: string }[];
      assertEquals(postChannels.map((row) => row.slug), [
        "gaming",
        "general",
        "programming",
        "technology",
      ]);

      const dmPairs = migrated
        .prepare(
          `SELECT conversation_id, user_low_id, user_high_id
           FROM direct_conversation_pairs
           ORDER BY conversation_id`,
        )
        .all() as { conversation_id: string; user_low_id: string; user_high_id: string }[];
      assertEquals(dmPairs.length, 3);
      assertEquals(
        dmPairs.map((row) => row.conversation_id).sort(),
        preDmIds.map((row) => row.id).sort(),
      );
      assertEquals(
        dmPairs.every((row) => row.user_low_id < row.user_high_id),
        true,
      );
      const postMessageCount = migrated
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number };
      assertEquals(postMessageCount.count, preMessageCount);

      const fkCheck = migrated.prepare("PRAGMA foreign_key_check").all();
      assertEquals(fkCheck, []);
      const integrity = migrated.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      assertEquals(integrity.integrity_check, "ok");

      const schema = migrated
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
      assertEquals(schema.some((row) => row.name === "idx_messages_room_created"), false);
      assertEquals(schema.some((row) => row.name === "idx_messages_conversation_created"), true);
      assertEquals(schema.some((row) => row.name === "idx_room_members_user"), false);
      assertEquals(schema.some((row) => row.name === "idx_conversation_memberships_user"), true);
      assertEquals(schema.some((row) => row.name === "idx_room_reads_user"), false);
      assertEquals(schema.some((row) => row.name === "idx_conversation_reads_user"), true);
      assertEquals(schema.some((row) => row.name === "idx_refresh_tokens_user"), false);
      assertEquals(schema.some((row) => row.name === "idx_user_sessions_user"), true);
      assertEquals(schema.some((row) => row.name === "idx_email_verification_tokens_user"), true);
      assertEquals(
        schema.some((row) => row.name === "idx_password_reset_tokens_user"),
        true,
      );
      assertEquals(schema.some((row) => row.name === "idx_email_change_tokens_user"), true);
      assertEquals(schema.some((row) => row.name === "idx_attachments_uploader"), true);
      assertEquals(schema.some((row) => row.tbl_name === "direct_conversation_pairs"), true);
      assertEquals(schema.some((row) => row.tbl_name === "email_verification_tokens"), true);
      assertEquals(schema.some((row) => row.tbl_name === "password_reset_tokens"), true);
      assertEquals(schema.some((row) => row.tbl_name === "email_change_tokens"), true);
      assertEquals(schema.some((row) => row.tbl_name === "rooms"), false);
      assertEquals(schema.some((row) => row.tbl_name === "room_members"), false);
      assertEquals(schema.some((row) => row.tbl_name === "room_reads"), false);
      assertEquals(schema.some((row) => row.tbl_name === "refresh_tokens"), false);

      const migratedUserColumns = migrated.prepare("PRAGMA table_info(users)").all() as Array<
        { name: string }
      >;
      assertEquals(
        migratedUserColumns.some((column) => column.name === "email_verified_at"),
        true,
      );

      const migratedSessionColumns = migrated.prepare("PRAGMA table_info(user_sessions)")
        .all() as Array<{ name: string }>;
      assertEquals(
        migratedSessionColumns.some((column) => column.name === "remembered"),
        true,
      );
      assertEquals(
        migratedSessionColumns.some((column) => column.name === "last_used_at"),
        true,
      );

      const sessionBackfill = migrated.prepare(
        "SELECT COUNT(*) AS count FROM user_sessions WHERE last_used_at IS NULL",
      ).get() as { count: number };
      assertEquals(sessionBackfill.count, 0);

      const existingUsersVerified = migrated.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE email_verified_at IS NULL",
      ).get() as { count: number };
      assertEquals(existingUsersVerified.count, 0);

      const existingUsersOnboarded = migrated.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE onboarding_preferences_completed_at IS NULL",
      ).get() as { count: number };
      assertEquals(existingUsersOnboarded.count, 0);

      const migrationCount = migrated
        .prepare("SELECT COUNT(*) as count FROM schema_migrations")
        .get() as { count: number };
      assertEquals(migrationCount.count, 11);
    } finally {
      migrated.close();
    }

    const reopened = await openDatabase(path, MIGRATIONS_DIR, logger);
    try {
      const migrationCount = reopened
        .prepare("SELECT COUNT(*) as count FROM schema_migrations")
        .get() as { count: number };
      assertEquals(migrationCount.count, 11);
    } finally {
      reopened.close();
    }
  } finally {
    await cleanupCopy();
  }
});

Deno.test("foreign keys are enforced", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    db.prepare("INSERT INTO conversations (id, type, is_public) VALUES (?, ?, ?)").run(
      "c-1",
      "channel",
      1,
    );
    let threw = false;
    try {
      db.prepare("INSERT INTO messages (id, conversation_id, content) VALUES (?, ?, ?)").run(
        "m1",
        "nonexistent-conversation",
        "hello",
      );
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    await cleanup();
  }
});
