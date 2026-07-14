import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import type { Db } from "../../src/storage/db.ts";

function seedUsers(db: Db) {
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
}

Deno.test("SqliteNotificationRepository: create + findById roundtrip", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const repo = new SqliteNotificationRepository(db);
    const created = repo.create({
      userId: "u-1",
      type: "dm",
      conversationId: null,
      messageId: null,
    });

    assertEquals(created.userId, "u-1");
    assertEquals(created.type, "dm");
    assertEquals(created.isRead, false);
    assertEquals(repo.findById(created.id), created);
    assertEquals(repo.findById("no-such-id"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteNotificationRepository.listForUser: scoped to the user, newest first, unreadOnly filters read ones out", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const repo = new SqliteNotificationRepository(db);
    const first = repo.create({ userId: "u-1", type: "dm", conversationId: null, messageId: null });
    const second = repo.create({
      userId: "u-1",
      type: "mention",
      conversationId: null,
      messageId: null,
    });
    repo.create({ userId: "u-2", type: "dm", conversationId: null, messageId: null });

    const all = repo.listForUser("u-1", false);
    assertEquals(all.map((n) => n.id), [second.id, first.id]); // newest first

    repo.markRead(first.id);
    assertEquals(repo.listForUser("u-1", true).map((n) => n.id), [second.id]);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteNotificationRepository.deleteByIdsForUser deletes only that user's rows and counts them", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const repo = new SqliteNotificationRepository(db);
    const own1 = repo.create({ userId: "u-1", type: "dm", conversationId: null, messageId: null });
    const own2 = repo.create({
      userId: "u-1",
      type: "mention",
      conversationId: null,
      messageId: null,
    });
    const foreign = repo.create({
      userId: "u-2",
      type: "dm",
      conversationId: null,
      messageId: null,
    });

    assertEquals(repo.deleteByIdsForUser("u-1", []), 0);
    assertEquals(repo.deleteByIdsForUser("u-1", [foreign.id, "no-such-id"]), 0);
    assertEquals(repo.findById(foreign.id)?.id, foreign.id);

    assertEquals(repo.deleteByIdsForUser("u-1", [own1.id, own2.id, foreign.id]), 2);
    assertEquals(repo.listForUser("u-1", false), []);
    assertEquals(repo.findById(foreign.id)?.id, foreign.id);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteNotificationRepository.deleteAllForUser clears only that user's rows", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const repo = new SqliteNotificationRepository(db);
    repo.create({ userId: "u-1", type: "dm", conversationId: null, messageId: null });
    repo.create({ userId: "u-1", type: "mention", conversationId: null, messageId: null });
    const foreign = repo.create({
      userId: "u-2",
      type: "dm",
      conversationId: null,
      messageId: null,
    });

    assertEquals(repo.deleteAllForUser("u-1"), 2);
    assertEquals(repo.deleteAllForUser("u-1"), 0);
    assertEquals(repo.listForUser("u-1", false), []);
    assertEquals(repo.findById(foreign.id)?.id, foreign.id);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteNotificationRepository.markAllReadForUser only touches that user's rows", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const repo = new SqliteNotificationRepository(db);
    repo.create({ userId: "u-1", type: "dm", conversationId: null, messageId: null });
    repo.create({ userId: "u-1", type: "mention", conversationId: null, messageId: null });
    const otherUsers = repo.create({
      userId: "u-2",
      type: "dm",
      conversationId: null,
      messageId: null,
    });

    repo.markAllReadForUser("u-1");

    assertEquals(repo.listForUser("u-1", true), []);
    assertEquals(repo.findById(otherUsers.id)?.isRead, false);
  } finally {
    await cleanup();
  }
});
