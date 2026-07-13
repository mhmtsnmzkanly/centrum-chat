import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { FakeConversationMemberRepository } from "../support/fakeConversationRepositories.ts";
import type { Conversation } from "../../src/domain/conversations/conversation.entity.ts";

function makeRoom(overrides: Partial<Conversation> & { type: Conversation["type"] }): Conversation {
  return {
    id: "room-1",
    slug: null,
    name: null,
    topic: null,
    ownerId: null,
    isPublic: false,
    description: "",
    sortOrder: 0,
    lifecycleState: "active",
    adminVersion: 1,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("PermissionService: any authenticated user can access a channel, no membership needed", () => {
  const service = new PermissionService(new FakeConversationMemberRepository());
  const channel = makeRoom({ type: "channel" });
  assertEquals(service.canAccessRoom(channel, "any-user"), true);
});

Deno.test("PermissionService: group access requires a room_members row", () => {
  const members = new FakeConversationMemberRepository();
  const group = makeRoom({ id: "g-1", type: "group" });
  members.add("g-1", "member-1", "member");

  const service = new PermissionService(members);
  assertEquals(service.canAccessRoom(group, "member-1"), true);
  assertEquals(service.canAccessRoom(group, "not-a-member"), false);
});

Deno.test("PermissionService.requireAccess throws ForbiddenError when denied", () => {
  const members = new FakeConversationMemberRepository();
  const dm = makeRoom({ id: "dm-1", type: "dm" });
  const service = new PermissionService(members);
  assertThrows(() => service.requireAccess(dm, "stranger"), ForbiddenError);
});

Deno.test("PermissionService.isModerator recognizes owner and moderator roles, not plain members", () => {
  const members = new FakeConversationMemberRepository();
  const group = makeRoom({ id: "g-1", type: "group" });
  members.add("g-1", "owner-1", "owner");
  members.add("g-1", "mod-1", "moderator");
  members.add("g-1", "member-1", "member");

  const service = new PermissionService(members);
  assertEquals(service.isModerator(group, "owner-1"), true);
  assertEquals(service.isModerator(group, "mod-1"), true);
  assertEquals(service.isModerator(group, "member-1"), false);
  assertEquals(service.isModerator(group, "stranger"), false);
});
