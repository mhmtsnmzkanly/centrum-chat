import { assertRejects } from "jsr:@std/assert@1";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { createLegacyDatabase } from "../support/legacyDatabase.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

function getLegacyDmRows(db: DatabaseSync): Array<{ conversationId: string; members: string[] }> {
  const rows = db.prepare(
    `SELECT r.id AS conversation_id, group_concat(m.user_id) AS members
     FROM rooms r
     LEFT JOIN room_members m ON m.room_id = r.id
     WHERE r.type = 'dm'
     GROUP BY r.id
     ORDER BY r.id`,
  ).all() as Array<{ conversation_id: string; members: string | null }>;
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    members: row.members ? row.members.split(",") : [],
  }));
}

Deno.test("direct conversation pair migration backfills valid DMs", async () => {
  const { path, cleanup } = await createLegacyDatabase();
  const logger = createLogger("error", "migration-valid-dms");
  try {
    const db = await openDatabase(path, MIGRATIONS_DIR, logger);
    try {
      const rows = db.prepare(
        `SELECT conversation_id, user_low_id, user_high_id
         FROM direct_conversation_pairs
         ORDER BY conversation_id`,
      ).all() as Array<{ conversation_id: string; user_low_id: string; user_high_id: string }>;
      if (rows.length !== 3) {
        throw new Error(`expected 3 backfilled DM pairs, got ${rows.length}`);
      }
      for (const row of rows) {
        if (!(row.user_low_id < row.user_high_id)) {
          throw new Error(`non-canonical pair ${row.user_low_id}/${row.user_high_id}`);
        }
      }
    } finally {
      db.close();
    }
  } finally {
    await cleanup();
  }
});

Deno.test("direct conversation pair migration fails on a one-member DM", async () => {
  const { path, cleanup } = await createLegacyDatabase();
  const logger = createLogger("error", "migration-one-member");
  try {
    const preDb = new DatabaseSync(path);
    const [dm] = getLegacyDmRows(preDb);
    if (!dm) throw new Error("expected at least one legacy DM");
    const [memberId] = dm.members;
    if (!memberId) throw new Error("expected a DM member to remove");
    preDb.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(
      dm.conversationId,
      memberId,
    );
    preDb.close();

    await assertRejects(
      () => openDatabase(path, MIGRATIONS_DIR, logger),
      Error,
      "Migration 0005_direct_conversation_pairs failed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("direct conversation pair migration fails on a three-member DM", async () => {
  const { path, cleanup } = await createLegacyDatabase();
  const logger = createLogger("error", "migration-three-member");
  try {
    const preDb = new DatabaseSync(path);
    const [dm] = getLegacyDmRows(preDb);
    if (!dm) throw new Error("expected at least one legacy DM");
    const existingMemberIds = new Set(dm.members);
    const extraUserRow = preDb.prepare(
      `SELECT id FROM users WHERE id NOT IN (${[...existingMemberIds].map(() => "?").join(", ")})
       ORDER BY id LIMIT 1`,
    ).get(...dm.members) as { id: string } | undefined;
    if (!extraUserRow) throw new Error("expected a third user to add");
    preDb.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')").run(
      dm.conversationId,
      extraUserRow.id,
    );
    preDb.close();

    await assertRejects(
      () => openDatabase(path, MIGRATIONS_DIR, logger),
      Error,
      `DM conversation ${dm.conversationId} has 3 members`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("direct conversation pair migration fails on duplicate DM pairs with useful diagnostics", async () => {
  const { path, cleanup } = await createLegacyDatabase();
  const logger = createLogger("error", "migration-duplicate-pairs");
  try {
    const preDb = new DatabaseSync(path);
    const dms = getLegacyDmRows(preDb);
    const first = dms[0];
    const second = dms[1];
    if (!first || !second) throw new Error("expected at least two legacy DMs");

    preDb.prepare("DELETE FROM room_members WHERE room_id = ?").run(second.conversationId);
    for (const memberId of first.members) {
      preDb.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')")
        .run(
          second.conversationId,
          memberId,
        );
    }
    preDb.close();

    await assertRejects(
      () => openDatabase(path, MIGRATIONS_DIR, logger),
      Error,
      `duplicate DM pair`,
    );
  } finally {
    await cleanup();
  }
});
