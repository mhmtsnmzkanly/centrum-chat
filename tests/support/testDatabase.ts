import { openDatabase } from "../../src/storage/db.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import type { Db } from "../../src/storage/db.ts";

const MIGRATIONS_DIR = new URL("../../db/migrations", import.meta.url).pathname;

/** Opens a fresh SQLite file under a temp dir, with all migrations applied — the
 * harness every repository test builds on (docs/06-implementation-plan.md Phase 0/9).
 * Call `cleanup()` when done to remove the file (and its WAL/SHM siblings). */
export async function createTestDb(): Promise<{ db: Db; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "centrumchat-test-" });
  const path = `${dir}/test.sqlite`;
  const logger = createLogger("error", "test-db");
  const db = await openDatabase(path, MIGRATIONS_DIR, logger);

  return {
    db,
    cleanup: async () => {
      db.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}
