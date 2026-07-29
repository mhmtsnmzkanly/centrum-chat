import { DatabaseSync } from "node:sqlite";

const root = await Deno.makeTempDir({ prefix: "centrum chat backup smoke-" });
const source = `${root}/source with spaces`;
const restored = `${root}/restored`;
const databasePath = `${source}/database/centrumchat.sqlite`;
const migrations = new URL("../db/migrations", import.meta.url).pathname;

async function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<void> {
  const result = await new Deno.Command(command, { args, env }).output();
  if (!result.success) throw new Error(`${command} ${args[0] ?? ""} failed.`);
}

async function createBackup(backup: string): Promise<void> {
  await run("bash", ["bin/backup-chat.sh", backup], {
    DATABASE_PATH: databasePath,
    MEDIA_ROOT: `${source}/storage`,
  });
}

async function expectRestoreRejected(backup: string, target: string, label: string): Promise<void> {
  const result = await new Deno.Command("bash", {
    args: ["bin/restore-chat.sh", backup, target],
  }).output();
  if (result.success) throw new Error(`Restore unexpectedly accepted ${label}.`);
}

try {
  await Deno.mkdir(`${source}/database`, { recursive: true });
  await Deno.mkdir(`${source}/storage/attachments`, { recursive: true });
  await run(Deno.execPath(), [
    "run",
    "--allow-read",
    "--allow-write",
    "tools/backupSmokeSeed.ts",
    databasePath,
    migrations,
  ]);
  await Deno.writeTextFile(`${source}/storage/attachments/smoke file.txt`, "media fixture");

  const goodBackup = `${root}/backup`;
  await createBackup(goodBackup);
  await run("bash", ["bin/restore-chat.sh", goodBackup, restored]);

  const restoredDb = new DatabaseSync(`${restored}/database/centrumchat.sqlite`);
  try {
    const user = restoredDb.prepare("SELECT id FROM users WHERE id = ?").get("smoke-user");
    const conversation = restoredDb.prepare("SELECT id FROM conversations WHERE id = ?").get(
      "smoke-conversation",
    );
    const membership = restoredDb.prepare(
      "SELECT role FROM conversation_memberships WHERE conversation_id = ? AND user_id = ?",
    ).get("smoke-conversation", "smoke-user") as { role: string } | undefined;
    const message = restoredDb.prepare(
      "SELECT content, conversation_id FROM messages WHERE id = ?",
    ).get("smoke-message") as { content: string; conversation_id: string } | undefined;
    const migration = restoredDb.prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as {
        version: number;
      };
    const columns = restoredDb.prepare("PRAGMA table_info(messages)").all() as Array<
      { name: string }
    >;
    const integrity = restoredDb.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    const foreignKeys = restoredDb.prepare("PRAGMA foreign_key_check").all();

    if (!user || !conversation || membership?.role !== "owner") {
      throw new Error("Restored relation is missing.");
    }
    if (message?.content !== "backup smoke" || message.conversation_id !== "smoke-conversation") {
      throw new Error("Restored message differs.");
    }
    if (
      migration.version !== 13 || !columns.some((column) => column.name === "client_operation_id")
    ) {
      throw new Error("Restored migration 0013 schema is missing.");
    }
    if (integrity.integrity_check !== "ok" || foreignKeys.length !== 0) {
      throw new Error("Restored SQLite checks failed.");
    }
  } finally {
    restoredDb.close();
  }
  if (
    await Deno.readTextFile(`${restored}/storage/attachments/smoke file.txt`) !== "media fixture"
  ) {
    throw new Error("Restored media differs.");
  }
  await expectRestoreRejected(goodBackup, restored, "an existing target");

  const corruptions = [
    ["manifest", "manifest.txt"],
    ["database", "database.sqlite"],
    ["media", "media/attachments/smoke file.txt"],
  ] as const;
  for (const [name, file] of corruptions) {
    const backup = `${root}/backup-${name}`;
    await createBackup(backup);
    await Deno.writeTextFile(`${backup}/${file}`, "corrupted", { append: true });
    await expectRestoreRejected(backup, `${root}/restore-${name}`, `a corrupted ${name} backup`);
  }
  console.log("backup/restore smoke: ok");
} finally {
  await Deno.remove(root, { recursive: true });
}
