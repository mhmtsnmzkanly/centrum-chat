import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../shared/logging/logger.ts";
import type { Logger } from "../shared/logging/logger.ts";
import { canonicalizeDirectConversationPair } from "../domain/conversations/directConversationPair.ts";
import type { TransactionManager } from "../shared/transactions/transactionManager.ts";

function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
}

export type Db = DatabaseSync;

interface TransactionState {
  depth: number;
  nextSavepointId: number;
}

const transactionStates = new WeakMap<Db, TransactionState>();
const rollbackLogger = createLogger("error", "storage-db");

function getTransactionState(db: Db): TransactionState {
  const state = transactionStates.get(db);
  if (state) return state;
  const created: TransactionState = { depth: 0, nextSavepointId: 0 };
  transactionStates.set(db, created);
  return created;
}

function logRollbackFailure(scope: string, error: unknown): void {
  rollbackLogger.error("sqlite rollback failed", { scope, error });
}

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly path: string;
}

function parseMigrationFileName(fileName: string): { version: number; name: string } | null {
  const match = /^(\d{4})_(.+)\.sql$/.exec(fileName);
  if (!match) return null;
  const versionPart = match[1];
  const namePart = match[2];
  if (versionPart === undefined || namePart === undefined) return null;
  return { version: Number.parseInt(versionPart, 10), name: namePart };
}

async function listMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (!entry.isFile) continue;
    const parsed = parseMigrationFileName(entry.name);
    if (!parsed) continue;
    files.push({ ...parsed, path: `${migrationsDir}/${entry.name}` });
  }
  files.sort((a, b) => a.version - b.version);
  return files;
}

function backfillDirectConversationPairs(db: Db): void {
  const rows = db.prepare(
    `SELECT conversations.id AS conversation_id, conversation_memberships.user_id AS user_id
     FROM conversations
     LEFT JOIN conversation_memberships ON conversation_memberships.conversation_id = conversations.id
     WHERE conversations.type = 'dm'
     ORDER BY conversations.id, conversation_memberships.user_id`,
  ).all() as Array<{ conversation_id: string; user_id: string | null }>;

  const memberIdsByConversation = new Map<string, string[]>();
  for (const row of rows) {
    const ids = memberIdsByConversation.get(row.conversation_id) ?? [];
    if (row.user_id !== null) ids.push(row.user_id);
    memberIdsByConversation.set(row.conversation_id, ids);
  }

  const pairConversationIds = new Map<string, string[]>();
  const pairsToInsert: Array<{ conversationId: string; userLowId: string; userHighId: string }> =
    [];

  for (const [conversationId, memberIds] of memberIdsByConversation) {
    const distinctMemberIds = [...new Set(memberIds)];
    if (distinctMemberIds.length !== 2) {
      throw new Error(
        `Migration 0005_direct_conversation_pairs failed: DM conversation ${conversationId} has ${distinctMemberIds.length} members (${
          distinctMemberIds.join(", ") || "none"
        }).`,
      );
    }

    const { userLowId, userHighId } = canonicalizeDirectConversationPair(
      distinctMemberIds[0]!,
      distinctMemberIds[1]!,
    );
    const key = `${userLowId}:${userHighId}`;
    const conversationIds = pairConversationIds.get(key) ?? [];
    conversationIds.push(conversationId);
    pairConversationIds.set(key, conversationIds);
    pairsToInsert.push({ conversationId, userLowId, userHighId });
  }

  const duplicatePair = [...pairConversationIds.entries()].find(([, conversationIds]) =>
    conversationIds.length > 1
  );
  if (duplicatePair) {
    const [key, conversationIds] = duplicatePair;
    const [userLowId, userHighId] = key.split(":");
    throw new Error(
      `Migration 0005_direct_conversation_pairs failed: duplicate DM pair ${userLowId}/${userHighId} found in conversations ${
        conversationIds.join(", ")
      }.`,
    );
  }

  for (const pair of pairsToInsert) {
    db.prepare(
      `INSERT INTO direct_conversation_pairs (conversation_id, user_low_id, user_high_id)
       VALUES (?, ?, ?)`,
    ).run(pair.conversationId, pair.userLowId, pair.userHighId);
  }
}

/** Opens the SQLite database at `databasePath`, applies WAL mode + foreign key
 * enforcement, and runs any pending migrations found in `migrationsDir`. Schema is
 * never generated dynamically — every table originates from a numbered .sql file. */
export async function openDatabase(
  databasePath: string,
  migrationsDir: string,
  logger: Logger,
): Promise<Db> {
  await Deno.mkdir(dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);

  const appliedVersions = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) =>
      row["version"] as number
    ),
  );

  const migrationFiles = await listMigrationFiles(migrationsDir);
  const pending = migrationFiles.filter((file) => !appliedVersions.has(file.version));

  for (const file of pending) {
    const sql = await Deno.readTextFile(file.path);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      if (file.version === 5) {
        backfillDirectConversationPairs(db);
      }
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        file.version,
        file.name,
      );
      db.exec("COMMIT");
      logger.info("migration applied", { version: file.version, name: file.name });
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file.path} failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  return db;
}

/** Runs `fn` inside a BEGIN/COMMIT transaction, rolling back on any thrown error. */
export function withTransaction<T>(db: Db, fn: (db: Db) => T): T {
  const state = getTransactionState(db);
  if (state.depth === 0) {
    db.exec("BEGIN");
    state.depth = 1;
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        logRollbackFailure("transaction", rollbackError);
      }
      throw error;
    } finally {
      state.depth = 0;
    }
  }

  const savepoint = `tx_${state.nextSavepointId++}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  state.depth += 1;
  try {
    const result = fn(db);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      logRollbackFailure(`savepoint ${savepoint}`, rollbackError);
    }
    try {
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (releaseError) {
      logRollbackFailure(`savepoint ${savepoint} release`, releaseError);
    }
    throw error;
  } finally {
    state.depth = Math.max(0, state.depth - 1);
  }
}

export class SqliteTransactionManager implements TransactionManager {
  constructor(private readonly db: Db) {}

  run<T>(fn: () => T): T {
    return withTransaction(this.db, () => fn());
  }
}
