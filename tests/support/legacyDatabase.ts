import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

/** Builds a deterministic migration-0003 fixture without depending on the mutable development DB. */
export async function createLegacyDatabase(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-legacy-" });
  const migrationDir = `${dir}/migrations`;
  const path = `${dir}/legacy.sqlite`;
  await Deno.mkdir(migrationDir);
  for (const name of ["0001_init.sql", "0002_seed_channels.sql", "0003_attachment_kind.sql"]) {
    await Deno.copyFile(`${MIGRATIONS_DIR}/${name}`, `${migrationDir}/${name}`);
  }
  const db = await openDatabase(
    path,
    migrationDir,
    createLogger("error", "legacy-fixture"),
  );
  try {
    for (const id of ["alice", "bob", "carol", "dave"]) {
      db.prepare(
        "INSERT INTO users (id,username,display_name,email,password_hash) VALUES (?,?,?,?,?)",
      ).run(id, id, id, `${id}@example.com`, "legacy-hash");
    }
    const pairs: Array<readonly [string, string, string]> = [
      ["dm-ab", "alice", "bob"],
      ["dm-ac", "alice", "carol"],
      ["dm-bc", "bob", "carol"],
    ];
    for (const [conversationId, first, second] of pairs) {
      db.prepare("INSERT INTO rooms (id,type,is_public) VALUES (?,'dm',0)").run(
        conversationId,
      );
      db.prepare("INSERT INTO room_members (room_id,user_id,role) VALUES (?,?,'member')").run(
        conversationId,
        first,
      );
      db.prepare("INSERT INTO room_members (room_id,user_id,role) VALUES (?,?,'member')").run(
        conversationId,
        second,
      );
      db.prepare(
        "INSERT INTO messages (id,room_id,author_id,content) VALUES (?,?,?,?)",
      ).run(`message-${conversationId}`, conversationId, first, "legacy message");
    }
  } finally {
    db.close();
  }
  return {
    path,
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}
