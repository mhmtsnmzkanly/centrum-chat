import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { ConflictError } from "../../src/shared/errors/conflictError.ts";

Deno.test("SqliteUserRepository: create + findById/findByEmail/findByUsername roundtrip", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    const created = repo.create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });

    assertEquals(created.username, "alice");
    assertEquals(created.status, "offline");
    assertEquals(created.isPremium, false);

    assertEquals(repo.findById("u-1")?.email, "alice@example.com");
    assertEquals(repo.findByEmail("alice@example.com")?.id, "u-1");
    assertEquals(repo.findByUsername("alice")?.id, "u-1");
    assertEquals(repo.findById("does-not-exist"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserRepository: email and username are unique, raised as ConflictError (not a raw SQLite error)", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    repo.create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });

    // Guards the race AuthService.register's pre-check can't close: two concurrent
    // signups for the same email/username both pass the pre-check, and only the DB's
    // UNIQUE constraint actually catches the second one.
    assertThrows(
      () =>
        repo.create({
          id: "u-2",
          username: "alice",
          displayName: "Alice Two",
          email: "someone-else@example.com",
          passwordHash: "hash",
        }),
      ConflictError,
    );
    assertThrows(
      () =>
        repo.create({
          id: "u-3",
          username: "someone-else",
          displayName: "Someone Else",
          email: "alice@example.com",
          passwordHash: "hash",
        }),
      ConflictError,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserRepository: update applies a partial patch and leaves other fields untouched", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    repo.create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });

    const updated = repo.update("u-1", { displayName: "Alice Two", coverIndex: 3 });
    assertEquals(updated.displayName, "Alice Two");
    assertEquals(updated.coverIndex, 3);
    assertEquals(updated.bio, ""); // untouched field keeps its previous value

    const updatedAgain = repo.update("u-1", { bio: "hello there" });
    assertEquals(updatedAgain.displayName, "Alice Two"); // still untouched by this second patch
    assertEquals(updatedAgain.bio, "hello there");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserRepository password update compare-and-swap rejects a stale hash", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    repo.create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "original-hash",
    });

    assertEquals(
      repo.updatePasswordHashIfCurrent("u-1", "stale-hash", "attacker-hash"),
      null,
    );
    assertEquals(repo.findById("u-1")?.passwordHash, "original-hash");
    assertEquals(
      repo.updatePasswordHashIfCurrent("u-1", "original-hash", "replacement-hash")
        ?.passwordHash,
      "replacement-hash",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserRepository: updateStatus sets status and only touches lastSeenAt when given", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    repo.create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });

    repo.updateStatus("u-1", "online");
    assertEquals(repo.findById("u-1")?.status, "online");
    assertEquals(repo.findById("u-1")?.lastSeenAt, null);

    repo.updateStatus("u-1", "offline", "2026-01-01T00:00:00.000Z");
    assertEquals(repo.findById("u-1")?.status, "offline");
    assertEquals(repo.findById("u-1")?.lastSeenAt, "2026-01-01T00:00:00.000Z");

    repo.updateStatus("u-1", "online"); // no lastSeenAt passed -> previous value preserved
    assertEquals(repo.findById("u-1")?.status, "online");
    assertEquals(repo.findById("u-1")?.lastSeenAt, "2026-01-01T00:00:00.000Z");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserRepository.search matches username or display name, case-insensitively", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = new SqliteUserRepository(db);
    repo.create({
      id: "u-1",
      username: "bob_builder",
      displayName: "Bob the Builder",
      email: "bob@example.com",
      passwordHash: "hash",
    });
    repo.create({
      id: "u-2",
      username: "alice",
      displayName: "Alice Wonderland",
      email: "alice@example.com",
      passwordHash: "hash",
    });

    assertEquals(repo.search("bob", 10).map((u) => u.id), ["u-1"]);
    assertEquals(repo.search("WONDER", 10).map((u) => u.id), ["u-2"]);
    assertEquals(repo.search("nonexistent", 10), []);
  } finally {
    await cleanup();
  }
});
