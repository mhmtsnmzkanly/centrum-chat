import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";

function seedRoomAndMessage(db: import("../../src/storage/db.ts").Db) {
  const users = new SqliteUserRepository(db);
  users.create({
    id: "u-1",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });
  users.create({
    id: "u-2",
    username: "bob",
    displayName: "Bob",
    email: "bob@example.com",
    passwordHash: "hash",
  });
  const rooms = new SqliteConversationRepository(db);
  const room = rooms.create({ id: "c-1", type: "channel", slug: "reactions-test", isPublic: true });
  const messages = new SqliteMessageRepository(db);
  const message = messages.create({
    id: "m-1",
    conversationId: room.id,
    authorId: "u-1",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });
  return { room, message };
}

Deno.test("SqliteReactionRepository: add/exists/remove", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { message } = seedRoomAndMessage(db);
    const reactions = new SqliteReactionRepository(db);

    assertEquals(reactions.exists(message.id, "u-1", "👍"), false);
    reactions.add(message.id, "u-1", "👍");
    assertEquals(reactions.exists(message.id, "u-1", "👍"), true);

    reactions.remove(message.id, "u-1", "👍");
    assertEquals(reactions.exists(message.id, "u-1", "👍"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteReactionRepository: listForMessage aggregates userIds per emoji", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { message } = seedRoomAndMessage(db);
    const reactions = new SqliteReactionRepository(db);

    reactions.add(message.id, "u-1", "👍");
    reactions.add(message.id, "u-2", "👍");
    reactions.add(message.id, "u-1", "🎉");

    const summary = reactions.listForMessage(message.id);
    const byEmoji = Object.fromEntries(summary.map((r) => [r.emoji, r.userIds.sort()]));
    assertEquals(byEmoji, { "👍": ["u-1", "u-2"], "🎉": ["u-1"] });
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteReactionRepository: listForMessage returns empty for a message with no reactions", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { message } = seedRoomAndMessage(db);
    const reactions = new SqliteReactionRepository(db);
    assertEquals(reactions.listForMessage(message.id), []);
  } finally {
    await cleanup();
  }
});
