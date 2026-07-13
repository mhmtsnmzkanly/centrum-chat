import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { FakeDirectConversationPairRepository } from "../support/fakeDirectConversationPairRepository.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import { FakePreferencesRepository } from "../support/fakePreferencesRepository.ts";
import { FakeTransactionManager } from "../support/fakeTransactionManager.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";

function makeUser(users: FakeUserRepository, id: string) {
  return users.create({
    id,
    username: id,
    displayName: id,
    email: `${id}@example.com`,
    passwordHash: "hash",
  });
}

function makeServices() {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const pairRepo = new FakeDirectConversationPairRepository();
  const users = new FakeUserRepository();
  const preferences = new FakePreferencesRepository();
  const transactions = new FakeTransactionManager();
  const dmService = new DmService(roomRepo, memberRepo, pairRepo, users, preferences, transactions);
  const groupService = new GroupService(roomRepo, memberRepo, users, preferences);
  return { dmService, groupService, roomRepo, memberRepo, pairRepo, users, preferences };
}

Deno.test("DmService.openDm creates a room on first call and reuses it on the second", () => {
  const { dmService, users } = makeServices();
  makeUser(users, "alice");
  makeUser(users, "bob");

  const first = dmService.openDm("alice", "bob");
  const second = dmService.openDm("alice", "bob");
  assertEquals(first.id, second.id);
  assertEquals(first.memberCount, 2);
});

Deno.test("DmService.openDm reuses the same room regardless of caller order", () => {
  const { dmService, users } = makeServices();
  makeUser(users, "alice");
  makeUser(users, "bob");

  const first = dmService.openDm("alice", "bob");
  const second = dmService.openDm("bob", "alice");
  assertEquals(first.id, second.id);
});

Deno.test("DmService.openDm rejects opening a DM with yourself", () => {
  const { dmService, users } = makeServices();
  makeUser(users, "alice");
  assertThrows(() => dmService.openDm("alice", "alice"), ValidationError);
});

Deno.test("DmService.openDm rejects an unknown target user", () => {
  const { dmService, users } = makeServices();
  makeUser(users, "alice");
  assertThrows(() => dmService.openDm("alice", "ghost"), NotFoundError);
});

Deno.test("DmService.openDm is blocked by the target's dmPrivacy = no_one", () => {
  const { dmService, users, preferences } = makeServices();
  makeUser(users, "alice");
  makeUser(users, "bob");
  preferences.update("bob", { dmPrivacy: "no_one" });

  assertThrows(() => dmService.openDm("alice", "bob"), ForbiddenError);
});

Deno.test("DmService.openDm with dmPrivacy = group_members requires a shared group", () => {
  const { dmService, groupService, users, preferences } = makeServices();
  makeUser(users, "alice");
  makeUser(users, "bob");
  makeUser(users, "carol");
  makeUser(users, "dave");
  preferences.update("bob", { dmPrivacy: "group_members" });

  // alice and bob share no group yet -> denied
  assertThrows(() => dmService.openDm("alice", "bob"), ForbiddenError);

  // once they're in a group together, it's allowed
  groupService.create("bob", "Shared group", ["alice", "carol", "dave"]);
  const room = dmService.openDm("alice", "bob");
  assertEquals(room.type, "dm");
});

Deno.test("DmService.listDms returns only DM rooms the user belongs to", () => {
  const { dmService, users } = makeServices();
  makeUser(users, "alice");
  makeUser(users, "bob");
  makeUser(users, "carol");

  dmService.openDm("alice", "bob");
  dmService.openDm("bob", "carol"); // alice is not part of this one

  const aliceDms = dmService.listDms("alice");
  assertEquals(aliceDms.length, 1);
});
