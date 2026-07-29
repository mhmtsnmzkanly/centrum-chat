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
import { ValidationError } from "../../src/shared/errors/validationError.ts";

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

Deno.test("ConversationReadService.markRead rejects a message from another conversation", () => {
  const { service, roomRepo, messages } = makeServices();
  const first = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const second = roomRepo.create({ id: "c-2", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-2",
    conversationId: second.id,
    authorId: "u-1",
    content: "other conversation",
    replyToId: null,
    isSystem: false,
  });

  assertThrows(() => service.markRead("u-2", first.id, message.id), ValidationError);
  assertEquals(service.countUnread(first.id, "u-2"), 0);
});

Deno.test("ConversationReadService.markRead rejects an unknown message", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });

  assertThrows(() => service.markRead("u-2", channel.id, "missing"), ValidationError);
});

Deno.test("ConversationReadService.markRead accepts a soft-deleted message in its conversation", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "u-1",
    content: "removed",
    replyToId: null,
    isSystem: false,
  });
  messages.softDelete(message.id);

  service.markRead("u-2", channel.id, message.id);
  assertEquals(service.countUnread(channel.id, "u-2"), 0);
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
