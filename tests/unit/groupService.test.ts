import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  GroupService,
  MAX_GROUP_MEMBERS,
  MIN_GROUP_MEMBERS,
} from "../../src/domain/conversations/groupService.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import { FakePreferencesRepository } from "../support/fakePreferencesRepository.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { ConflictError } from "../../src/shared/errors/conflictError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";

function makeUser(users: FakeUserRepository, id: string, displayName: string) {
  return users.create({
    id,
    username: id,
    displayName,
    email: `${id}@example.com`,
    passwordHash: "hash",
  });
}

function makeService() {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const users = new FakeUserRepository();
  const preferences = new FakePreferencesRepository();
  const service = new GroupService(roomRepo, memberRepo, users, preferences);
  return { service, roomRepo, memberRepo, users, preferences };
}

Deno.test("GroupService.create requires at least 3 total members (creator + memberIds)", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u2", "User Two");

  assertThrows(() => service.create("owner", "Too small", ["u2"]), ValidationError);
});

Deno.test("GroupService.create rejects more than 25 total members", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  const memberIds: string[] = [];
  for (let i = 0; i < MAX_GROUP_MEMBERS; i++) {
    const id = `u${i}`;
    makeUser(users, id, `User ${i}`);
    memberIds.push(id);
  }
  // owner + MAX_GROUP_MEMBERS members = MAX_GROUP_MEMBERS + 1, over the limit
  assertThrows(() => service.create("owner", "Too big", memberIds), ValidationError);
});

Deno.test("GroupService.create succeeds at exactly the minimum and maximum sizes", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");

  const result = service.create("owner", "Just right", ["u1", "u2"]);
  assertEquals(result.room.memberCount, MIN_GROUP_MEMBERS);
  assert(result.systemMessageText.includes("Owner"));
  assertEquals([...result.addedMemberIds].sort(), ["u1", "u2"]);
});

Deno.test("GroupService.create de-duplicates memberIds and excludes the creator if listed", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");

  const result = service.create("owner", "Dedup test", ["u1", "u1", "u2", "owner"]);
  assertEquals(result.room.memberCount, 3); // owner + u1 + u2, duplicates/self removed
  // addedMemberIds reflects the same dedup/self-exclusion, for the notification layer.
  assertEquals([...result.addedMemberIds].sort(), ["u1", "u2"]);
});

Deno.test("GroupService.create rejects an unknown member id", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");

  assertThrows(() => service.create("owner", "Bad member", ["u1", "ghost"]), NotFoundError);
});

Deno.test("GroupService.addMember: only owner/moderator can add", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  makeUser(users, "outsider", "Outsider");
  makeUser(users, "newbie", "Newbie");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  assertThrows(
    () => service.addMember("outsider", room.id, "newbie"),
    ForbiddenError,
  );
});

Deno.test("GroupService.addMember succeeds for the owner and rejects an already-existing member", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  makeUser(users, "newbie", "Newbie");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  const result = service.addMember("owner", room.id, "newbie");
  assertEquals(result.room.memberCount, 4);
  assert(result.systemMessageText.includes("Newbie"));
  assertEquals(result.addedMemberIds, ["newbie"]);

  assertThrows(() => service.addMember("owner", room.id, "newbie"), ConflictError);
});

Deno.test("GroupService.addMember is blocked by the target's groupPrivacy = no_one", () => {
  const { service, users, preferences } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  makeUser(users, "private-user", "Private User");
  preferences.update("private-user", { groupPrivacy: "no_one" });
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  assertThrows(() => service.addMember("owner", room.id, "private-user"), ForbiddenError);
});

Deno.test("GroupService.removeMember: owner only, cannot remove self this way", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  assertThrows(() => service.removeMember("u1", room.id, "u2"), ForbiddenError);
  assertThrows(() => service.removeMember("owner", room.id, "owner"), ValidationError);

  const result = service.removeMember("owner", room.id, "u2");
  assertEquals(result.room.memberCount, 2);
  assert(result.systemMessageText.includes("Two")); // removed member's display name
  assertEquals(result.addedMemberIds, []); // not applicable to a removal
});

Deno.test("GroupService.leave transfers ownership to the oldest remaining member when the owner leaves", () => {
  const { service, users, memberRepo } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  const result = service.leave("owner", room.id);
  assertEquals(result.deleted, false);
  assert(result.systemMessageText.includes("Owner"));
  assert(result.systemMessageText.includes("is now the group owner"));
  assertEquals(result.room?.memberCount, 2); // u1 + u2 remain

  const remainingRoles = memberRepo.listMembers(room.id).map((m) => [m.userId, m.role]);
  const newOwner = remainingRoles.find(([, role]) => role === "owner");
  assertEquals(newOwner?.[0], "u1"); // u1 joined before u2, per creation order
});

Deno.test("GroupService.leave: a plain (non-owner) member leaving doesn't transfer ownership or delete the room", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  const result = service.leave("u1", room.id);
  assertEquals(result.deleted, false);
  assert(result.systemMessageText.includes("User One"));
  assert(!result.systemMessageText.includes("is now the group owner"));
  assertEquals(result.room?.memberCount, 2); // owner + u2 remain
});

Deno.test("GroupService.leave deletes the room when the last member leaves", () => {
  const { service, users, roomRepo } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  service.leave("owner", room.id);
  service.leave("u1", room.id);
  const result = service.leave("u2", room.id);

  assertEquals(result.deleted, true);
  assertEquals(result.room, null);
  assertEquals(roomRepo.findById(room.id), null);
});

Deno.test("GroupService.leave rejects a non-member", () => {
  const { service, users } = makeService();
  makeUser(users, "owner", "Owner");
  makeUser(users, "u1", "User One");
  makeUser(users, "u2", "User Two");
  const { room } = service.create("owner", "G", ["u1", "u2"]);

  assertThrows(() => service.leave("stranger", room.id), NotFoundError);
});
