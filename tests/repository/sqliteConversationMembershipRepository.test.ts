import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import type { Db } from "../../src/storage/db.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";

function seedThreeUsers(db: Db): void {
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

Deno.test("SqliteConversationMembershipRepository: add/find/list/remove", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedThreeUsers(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);
    const room = rooms.create({ id: "g-1", type: "group", name: "G", isPublic: false });

    members.add(room.id, "u-1", "owner");
    members.add(room.id, "u-2", "member");

    assertEquals(members.isMember(room.id, "u-1"), true);
    assertEquals(members.isMember(room.id, "u-3"), false);
    assertEquals(members.findMember(room.id, "u-1")?.role, "owner");
    assertEquals(members.countMembers(room.id), 2);
    assertEquals(members.listMembers(room.id).map((m) => m.userId).sort(), ["u-1", "u-2"]);

    members.remove(room.id, "u-2");
    assertEquals(members.countMembers(room.id), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationMembershipRepository: updateRole changes an existing member's role", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedThreeUsers(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);
    const room = rooms.create({ id: "g-1", type: "group", name: "G", isPublic: false });
    members.add(room.id, "u-1", "member");

    members.updateRole(room.id, "u-1", "owner");
    assertEquals(members.findMember(room.id, "u-1")?.role, "owner");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteConversationMembershipRepository: sharesGroupWith is true only for a shared group, not a shared DM", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    seedThreeUsers(db);
    const rooms = new SqliteConversationRepository(db);
    const members = new SqliteConversationMembershipRepository(db);

    const group = rooms.create({ id: "g-1", type: "group", name: "G", isPublic: false });
    members.add(group.id, "u-1", "owner");
    members.add(group.id, "u-2", "member");

    const dm = rooms.create({ id: "dm-1", type: "dm", isPublic: false });
    members.add(dm.id, "u-1", "member");
    members.add(dm.id, "u-3", "member");

    assertEquals(members.sharesGroupWith("u-1", "u-2"), true);
    assertEquals(members.sharesGroupWith("u-1", "u-3"), false); // shared DM, not a group
  } finally {
    await cleanup();
  }
});
