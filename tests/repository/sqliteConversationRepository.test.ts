import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";

Deno.test("SqliteConversationRepository: migration 0002 seeds the 4 default public channels", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const rooms = new SqliteConversationRepository(db);
    const channels = rooms.listChannels();
    assertEquals(channels.length, 4);
    assertEquals(channels.map((c) => c.slug).sort(), [
      "gaming",
      "general",
      "programming",
      "technology",
    ]);
    assertEquals(channels.every((c) => c.isPublic), true);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationRepository: create + findById/findBySlug roundtrip", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const rooms = new SqliteConversationRepository(db);
    const created = rooms.create({
      id: "r-1",
      type: "group",
      name: "My Group",
      isPublic: false,
      ownerId: null,
    });

    assertEquals(created.type, "group");
    assertEquals(rooms.findById("r-1")?.name, "My Group");
    assertEquals(rooms.findById("does-not-exist"), null);
    assertEquals(rooms.findBySlug("general")?.type, "channel");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationRepository: listGroupsForUser only returns groups the user is a member of", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);

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

    const groupA = rooms.create({ id: "g-a", type: "group", name: "A", isPublic: false });
    const groupB = rooms.create({ id: "g-b", type: "group", name: "B", isPublic: false });
    members.add(groupA.id, "u-1", "owner");
    members.add(groupB.id, "u-2", "owner");

    const aliceGroups = rooms.listGroupsForUser("u-1");
    assertEquals(aliceGroups.length, 1);
    assertEquals(aliceGroups[0]?.id, "g-a");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationRepository: findDmForPair finds a DM by either user, ignores non-matching pairs", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);
    const pairs = new SqliteDirectConversationPairRepository(db);

    for (const id of ["u-1", "u-2", "u-3"]) {
      users.create({
        id,
        username: id,
        displayName: id,
        email: `${id}@example.com`,
        passwordHash: "hash",
      });
    }

    const dm = rooms.create({ id: "dm-1", type: "dm", isPublic: false });
    members.add(dm.id, "u-1", "member");
    members.add(dm.id, "u-2", "member");
    pairs.createPair(dm.id, "u-1", "u-2");

    assertEquals(rooms.findDmForPair("u-1", "u-2")?.id, "dm-1");
    assertEquals(rooms.findDmForPair("u-2", "u-1")?.id, "dm-1");
    assertEquals(rooms.findDmForPair("u-1", "u-3"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationRepository: delete removes the room, transferOwnership updates owner_id", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    users.create({
      id: "new-owner-id",
      username: "newowner",
      displayName: "New Owner",
      email: "newowner@example.com",
      passwordHash: "hash",
    });
    const room = rooms.create({
      id: "g-1",
      type: "group",
      name: "G",
      isPublic: false,
      ownerId: null,
    });

    rooms.transferOwnership(room.id, "new-owner-id"); // owner_id has a FK to users(id)
    assertEquals(rooms.findById(room.id)?.ownerId, "new-owner-id");

    rooms.delete(room.id);
    assertEquals(rooms.findById(room.id), null);
  } finally {
    await cleanup();
  }
});
