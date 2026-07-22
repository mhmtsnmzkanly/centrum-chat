import { createLogger } from "../src/shared/logging/logger.ts";
import { openDatabase } from "../src/storage/db.ts";
import { SqliteUserRepository } from "../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteConversationReadRepository } from "../src/storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteMessageRepository } from "../src/storage/repositories/sqliteMessageRepository.ts";

const [databasePath, migrationsDir] = Deno.args;
if (!databasePath || !migrationsDir) {
  throw new Error("database path and migrations directory are required");
}
const db = await openDatabase(databasePath, migrationsDir, createLogger("error", "backup-smoke"));
try {
  new SqliteUserRepository(db).create({
    id: "smoke-user",
    username: "smoke",
    displayName: "Smoke",
    email: "smoke@example.com",
    passwordHash: "hash",
  });
  new SqliteConversationRepository(db).create({
    id: "smoke-conversation",
    type: "group",
    name: "Smoke group",
    ownerId: "smoke-user",
    isPublic: false,
  });
  new SqliteConversationMembershipRepository(db).add("smoke-conversation", "smoke-user", "owner");
  new SqliteMessageRepository(db).create({
    id: "smoke-message",
    conversationId: "smoke-conversation",
    authorId: "smoke-user",
    content: "backup smoke",
    replyToId: null,
    isSystem: false,
  });
  new SqliteConversationReadRepository(db).markRead(
    "smoke-conversation",
    "smoke-user",
    "smoke-message",
  );
} finally {
  db.close();
}
