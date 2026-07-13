import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import {
  FakeConversationReadRepository,
  FakeMessageRepository,
} from "../support/fakeMessageRepositories.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";

function makeServices() {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const messages = new FakeMessageRepository();
  const roomReads = new FakeConversationReadRepository(messages);
  const permissions = new PermissionService(memberRepo);
  const service = new ConversationReadService(roomReads, roomRepo, permissions);
  return { service, roomRepo, memberRepo, messages, roomReads };
}

Deno.test("ConversationReadService.countUnread: everything counts as unread before the first markRead", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "u-1",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });
  messages.create({
    id: "m-2",
    conversationId: channel.id,
    authorId: "u-1",
    content: "hi2",
    replyToId: null,
    isSystem: false,
  });

  assertEquals(service.countUnread(channel.id, "u-2"), 2);
});

Deno.test("ConversationReadService.markRead clears the counter up to the given message", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const m1 = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "u-1",
    content: "a",
    replyToId: null,
    isSystem: false,
  });
  messages.create({
    id: "m-2",
    conversationId: channel.id,
    authorId: "u-1",
    content: "b",
    replyToId: null,
    isSystem: false,
  });

  service.markRead("u-2", channel.id, m1.id);
  assertEquals(service.countUnread(channel.id, "u-2"), 1); // only m-2 remains unread
});

Deno.test("ConversationReadService.markRead denies access to a group the caller isn't a member of", () => {
  const { service, roomRepo } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  assertThrows(() => service.markRead("stranger", group.id, "m-1"), ForbiddenError);
});

Deno.test("ConversationReadService.markRead throws NotFoundError for an unknown room", () => {
  const { service } = makeServices();
  assertThrows(() => service.markRead("u-1", "no-such-room", "m-1"), NotFoundError);
});
