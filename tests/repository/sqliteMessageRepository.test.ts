import { assert, assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import type { Db } from "../../src/storage/db.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";

function seedRoomAndAuthor(db: Db) {
  const users = new SqliteUserRepository(db);
  users.create({
    id: "u-1",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });
  const rooms = new SqliteConversationRepository(db);
  const room = rooms.create({ id: "c-1", type: "channel", slug: "general2", isPublic: true });
  return { room };
}

Deno.test("SqliteMessageRepository: create + findById roundtrip", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const messages = new SqliteMessageRepository(db);

    const created = messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "hello",
      replyToId: null,
      isSystem: false,
    });

    assertEquals(created.content, "hello");
    assertEquals(created.editedAt, null);
    assertEquals(created.deletedAt, null);
    assertEquals(messages.findById("m-1")?.id, "m-1");
    assertEquals(messages.findById("does-not-exist"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteMessageRepository: updateContent sets editedAt, softDelete sets deletedAt", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "hello",
      replyToId: null,
      isSystem: false,
    });

    const edited = messages.updateContent("m-1", "edited content");
    assertEquals(edited.content, "edited content");
    assert(edited.editedAt !== null);

    const deleted = messages.softDelete("m-1");
    assert(deleted.deletedAt !== null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteMessageRepository: history pages ascending, ending just before the cursor, with hasMore", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const messages = new SqliteMessageRepository(db);
    const ids = ["m-0", "m-1", "m-2", "m-3", "m-4"];
    for (const id of ids) {
      messages.create({
        id,
        conversationId: room.id,
        authorId: "u-1",
        content: id,
        replyToId: null,
        isSystem: false,
      });
    }

    const firstPage = messages.history(room.id, null, 3);
    assertEquals(firstPage.hasMore, true);
    assertEquals(firstPage.messages.map((m) => m.id), ["m-2", "m-3", "m-4"]);

    const secondPage = messages.history(room.id, "m-2", 3);
    assertEquals(secondPage.hasMore, false);
    assertEquals(secondPage.messages.map((m) => m.id), ["m-0", "m-1"]);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteMessageRepository: history includes soft-deleted messages as tombstones", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "hello",
      replyToId: null,
      isSystem: false,
    });
    messages.softDelete("m-1");

    const page = messages.history(room.id, null, 10);
    assertEquals(page.messages.length, 1);
    assert(page.messages[0]!.deletedAt !== null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteMessageRepository.search: substring match scoped to the room, newest first, excludes soft-deleted", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const otherRoom = new SqliteConversationRepository(db).create({
      id: "c-2",
      type: "channel",
      slug: "other-room",
      isPublic: true,
    });
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "the quick brown fox",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-2",
      conversationId: room.id,
      authorId: "u-1",
      content: "another quick message",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-3",
      conversationId: otherRoom.id,
      authorId: "u-1",
      content: "quick but in the wrong room",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-4",
      conversationId: room.id,
      authorId: "u-1",
      content: "quick but deleted",
      replyToId: null,
      isSystem: false,
    });
    messages.softDelete("m-4");

    const results = messages.search(room.id, "quick", 10);
    assertEquals(results.map((m) => m.id), ["m-2", "m-1"]);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteMessageRepository.search escapes LIKE wildcards in the query", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { room } = seedRoomAndAuthor(db);
    const messages = new SqliteMessageRepository(db);
    messages.create({
      id: "m-1",
      conversationId: room.id,
      authorId: "u-1",
      content: "50% off everything",
      replyToId: null,
      isSystem: false,
    });
    messages.create({
      id: "m-2",
      conversationId: room.id,
      authorId: "u-1",
      content: "totally unrelated content",
      replyToId: null,
      isSystem: false,
    });

    // A literal "%" in the query must not act as a wildcard matching every message.
    const results = messages.search(room.id, "50%", 10);
    assertEquals(results.map((m) => m.id), ["m-1"]);
  } finally {
    await cleanup();
  }
});
