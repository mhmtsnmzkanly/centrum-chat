import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteConversationReadRepository } from "../../src/storage/repositories/sqliteConversationReadRepository.ts";

Deno.test("SqliteConversationReadRepository: countUnread is total non-deleted messages before any markRead", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const rooms = new SqliteConversationRepository(db);
    const room = rooms.create({ id: "c-1", type: "channel", slug: "s1", isPublic: true });
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "1",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-2",
      conversationId: room.id,
      authorId: "u-1",
      content: "2",
      replyToId: null,
      isSystem: false,
    });

    const roomReads = new SqliteConversationReadRepository(db);
    assertEquals(roomReads.countUnread(room.id, "u-2"), 2);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationReadRepository: markRead upserts and clears unread up to that message", async () => {
  const { db, cleanup } = await createTestDb();
  try {
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
    const room = rooms.create({ id: "c-1", type: "channel", slug: "s1", isPublic: true });
    const messages = new SqliteMessageRepository(db);
    const m1 = messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "1",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-2",
      conversationId: room.id,
      authorId: "u-1",
      content: "2",
      replyToId: null,
      isSystem: false,
    });

    const roomReads = new SqliteConversationReadRepository(db);
    roomReads.markRead(room.id, "u-2", m1.id);
    assertEquals(roomReads.getLastReadMessageId(room.id, "u-2"), m1.id);
    assertEquals(roomReads.countUnread(room.id, "u-2"), 1);

    // upsert: marking read again with a different message updates the same row
    roomReads.markRead(room.id, "u-2", "m-2");
    assertEquals(roomReads.getLastReadMessageId(room.id, "u-2"), "m-2");
    assertEquals(roomReads.countUnread(room.id, "u-2"), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationReadRepository: soft-deleted messages don't count toward unread", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const rooms = new SqliteConversationRepository(db);
    const room = rooms.create({ id: "c-1", type: "channel", slug: "s1", isPublic: true });
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "1",
      replyToId: null,
      isSystem: false,
    });
    messages.softDelete("m-1");

    const roomReads = new SqliteConversationReadRepository(db);
    assertEquals(roomReads.countUnread(room.id, "u-2"), 0);
  } finally {
    await cleanup();
  }
});
