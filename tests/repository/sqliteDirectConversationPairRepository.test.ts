import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import type { Db } from "../../src/storage/db.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";

function seedUsers(db: Db): void {
  const users = new SqliteUserRepository(db);
  for (const id of ["u-1", "u-2", "u-3"]) {
    users.create({
      id,
      username: id,
      displayName: id,
      email: `${id}@example.com`,
      passwordHash: "hash",
    });
  }
}

Deno.test("SqliteDirectConversationPairRepository stores and resolves canonical DM pairs", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);
    const pairs = new SqliteDirectConversationPairRepository(db);
    const dm = rooms.create({ id: "dm-1", type: "dm", isPublic: false });

    members.add(dm.id, "u-1", "member");
    members.add(dm.id, "u-2", "member");
    pairs.createPair(dm.id, "u-2", "u-1");

    assertEquals(pairs.findConversationIdByUsers("u-1", "u-2"), "dm-1");
    assertEquals(pairs.findConversationIdByUsers("u-2", "u-1"), "dm-1");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteDirectConversationPairRepository rejects duplicate canonical pairs and self-pairs", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedUsers(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);
    const pairs = new SqliteDirectConversationPairRepository(db);
    const first = rooms.create({ id: "dm-1", type: "dm", isPublic: false });
    const second = rooms.create({ id: "dm-2", type: "dm", isPublic: false });

    members.add(first.id, "u-1", "member");
    members.add(first.id, "u-2", "member");
    members.add(second.id, "u-1", "member");
    members.add(second.id, "u-3", "member");

    pairs.createPair(first.id, "u-1", "u-2");
    assertThrows(
      () => pairs.createPair(second.id, "u-2", "u-1"),
      Error,
    );
    assertThrows(
      () => pairs.createPair("dm-self", "u-1", "u-1"),
      ValidationError,
    );
  } finally {
    await cleanup();
  }
});
