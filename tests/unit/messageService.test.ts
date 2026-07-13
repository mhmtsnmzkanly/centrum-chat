import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { FakeMessageRepository } from "../support/fakeMessageRepositories.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { FakeReactionRepository } from "../support/fakeReactionRepository.ts";
import { FakeAttachmentRepository } from "../support/fakeAttachmentRepository.ts";
import { FakeTransactionManager } from "../support/fakeTransactionManager.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";
import { RateLimitedError } from "../../src/shared/errors/rateLimitedError.ts";
import { EditMessageHandler } from "../../src/application/websocket/handlers/messages/editMessageHandler.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";

function makeServices(
  rateLimit = { maxTokens: 1000, refillIntervalMs: 10_000 },
  safetyGuard?: ConstructorParameters<typeof MessageService>[7],
) {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const messages = new FakeMessageRepository();
  const permissions = new PermissionService(memberRepo);
  const rateLimiter = new RateLimiter(rateLimit);
  const transactions = new FakeTransactionManager();
  const reactions = new FakeReactionRepository();
  const attachments = new FakeAttachmentRepository();
  const service = new MessageService(
    messages,
    roomRepo,
    permissions,
    rateLimiter,
    transactions,
    reactions,
    attachments,
    safetyGuard,
  );
  return { service, roomRepo, memberRepo, messages, attachments };
}

Deno.test("MessageService.send: any authenticated user can post in a channel", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });

  const message = service.send("any-user", channel.id, "hello", null);
  assertEquals(message.content, "hello");
  assertEquals(message.authorId, "any-user");
  assertEquals(message.reactions, []);
  assertEquals(message.attachments, []);
});

Deno.test("MessageService.send: group/dm requires a room_members row", () => {
  const { service, roomRepo, memberRepo } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  memberRepo.add(group.id, "member-1", "member");

  assertThrows(() => service.send("stranger", group.id, "hi", null), ForbiddenError);
  const message = service.send("member-1", group.id, "hi", null);
  assertEquals(message.content, "hi");
});

Deno.test("MessageService.send validates replyToId refers to a message in the same room", () => {
  const { service, roomRepo } = makeServices();
  const channelA = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const channelB = roomRepo.create({ id: "c-2", type: "channel", isPublic: true });
  const messageInA = service.send("u-1", channelA.id, "first", null);

  assertThrows(() => service.send("u-1", channelB.id, "reply", messageInA.id), ValidationError);
  assertThrows(() => service.send("u-1", channelA.id, "reply", "does-not-exist"), ValidationError);

  const reply = service.send("u-1", channelA.id, "reply", messageInA.id);
  assertEquals(reply.replyToId, messageInA.id);
});

Deno.test("MessageService.send is rate-limited per user", () => {
  const { service, roomRepo } = makeServices({ maxTokens: 2, refillIntervalMs: 10_000 });
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });

  service.send("u-1", channel.id, "1", null);
  service.send("u-1", channel.id, "2", null);
  assertThrows(() => service.send("u-1", channel.id, "3", null), RateLimitedError);
  // a different user has their own bucket
  service.send("u-2", channel.id, "1", null);
});

Deno.test("MessageService.edit: author-only", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = service.send("author", channel.id, "original", null);

  assertThrows(() => service.edit("someone-else", message.id, "hacked"), ForbiddenError);
  const edited = service.edit("author", message.id, "edited");
  assertEquals(edited.content, "edited");
  assertEquals(edited.edited, true);
});

Deno.test("MessageService.edit rejects editing a deleted message", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = service.send("author", channel.id, "original", null);
  service.delete("author", message.id);

  assertThrows(() => service.edit("author", message.id, "too late"), ForbiddenError);
});

Deno.test("EditMessageHandler applies the runtime max_message_length setting", () => {
  const { service, roomRepo, memberRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = service.send("author", channel.id, "original", null);
  const handler = new EditMessageHandler(
    service,
    roomRepo,
    memberRepo,
    new RateLimiter({ maxTokens: 10, refillIntervalMs: 1000 }),
    new ConnectionManager(),
    new JsonCodec(),
    undefined,
    () => 5,
  );
  assertThrows(
    () =>
      handler.handle(
        { userId: "author", connectionId: "connection" },
        { messageId: message.id, content: "123456" },
      ),
    ValidationError,
  );
});

Deno.test("MessageService checks the authoritative mutation guard before edit and delete", () => {
  let blocked = false;
  const { service, roomRepo, messages } = makeServices(
    undefined,
    {
      requireMessage() {},
      requireMutation() {
        if (blocked) throw new ValidationError("archived");
      },
    },
  );
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = service.send("author", channel.id, "original", null);
  blocked = true;
  assertThrows(() => service.edit("author", message.id, "changed"), ValidationError);
  assertEquals(messages.findById(message.id)?.content, "original");
  assertThrows(() => service.delete("author", message.id), ValidationError);
  assertEquals(messages.findById(message.id)?.deletedAt, null);
});

Deno.test("MessageService.delete: author can delete their own message in a channel", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = service.send("author", channel.id, "bye", null);

  const deleted = service.delete("author", message.id);
  assert(deleted.deletedAt !== null);
});

Deno.test("MessageService.delete: a channel moderator can delete someone else's message", () => {
  const { service, roomRepo, memberRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  memberRepo.add(channel.id, "mod-1", "moderator"); // sparse channel moderator row
  const message = service.send("author", channel.id, "bye", null);

  assertThrows(() => service.delete("random-user", message.id), ForbiddenError);
  const deleted = service.delete("mod-1", message.id);
  assert(deleted.deletedAt !== null);
});

Deno.test("MessageService.delete: a group owner can delete a member's message", () => {
  const { service, roomRepo, memberRepo } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  memberRepo.add(group.id, "owner-1", "owner");
  memberRepo.add(group.id, "member-1", "member");
  const message = service.send("member-1", group.id, "hi", null);

  const deleted = service.delete("owner-1", message.id);
  assert(deleted.deletedAt !== null);
});

Deno.test("MessageService.history returns an ascending page and hasMore", () => {
  const { service, roomRepo } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const sent = [];
  for (let i = 0; i < 5; i++) {
    sent.push(service.send("u-1", channel.id, `msg-${i}`, null));
  }

  const page = service.history("u-1", channel.id, null, 3);
  assertEquals(page.messages.length, 3);
  assertEquals(page.hasMore, true);
  // ascending order: oldest of this page first
  assertEquals(page.messages.map((m) => m.content), ["msg-2", "msg-3", "msg-4"]);

  const nextPage = service.history("u-1", channel.id, page.messages[0]!.id, 3);
  assertEquals(nextPage.hasMore, false);
  assertEquals(nextPage.messages.map((m) => m.content), ["msg-0", "msg-1"]);
});

Deno.test("MessageService.history denies a non-member of a group", () => {
  const { service, roomRepo } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  assertThrows(() => service.history("stranger", group.id, null, 50), ForbiddenError);
});

Deno.test("MessageService operations throw NotFoundError for a missing room/message", () => {
  const { service } = makeServices();
  assertThrows(() => service.send("u-1", "no-such-room", "hi", null), NotFoundError);
  assertThrows(() => service.edit("u-1", "no-such-message", "hi"), NotFoundError);
  assertThrows(() => service.delete("u-1", "no-such-message"), NotFoundError);
});

Deno.test("MessageService.send attaches a previously uploaded, unattached attachment", () => {
  const { service, roomRepo, attachments } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const upload = attachments.create({
    id: "a-1",
    uploaderId: "u-1",
    kind: "attachment",
    fileName: "photo.png",
    mimeType: "image/png",
    sizeBytes: 1234,
    storagePath: "attachments/a-1",
  });

  const message = service.send("u-1", channel.id, "look at this", null, upload.id);

  assertEquals(message.attachments, [
    { id: "a-1", fileName: "photo.png", mimeType: "image/png", sizeBytes: 1234, url: "/media/a-1" },
  ]);
  assertEquals(attachments.findById("a-1")?.messageId, message.id);
});

Deno.test("MessageService.send rejects an attachmentId that doesn't exist, is an avatar, or is already attached", () => {
  const { service, roomRepo, attachments } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });

  assertThrows(
    () => service.send("u-1", channel.id, "hi", null, "no-such-attachment"),
    ValidationError,
  );

  attachments.create({
    id: "avatar-1",
    uploaderId: "u-1",
    kind: "avatar",
    fileName: "me.png",
    mimeType: "image/png",
    sizeBytes: 100,
    storagePath: "avatars/avatar-1",
  });
  assertThrows(() => service.send("u-1", channel.id, "hi", null, "avatar-1"), ValidationError);

  const alreadyAttached = attachments.create({
    id: "a-2",
    uploaderId: "u-1",
    kind: "attachment",
    fileName: "doc.pdf",
    mimeType: "application/pdf",
    sizeBytes: 500,
    storagePath: "attachments/a-2",
  });
  attachments.attachToMessage(alreadyAttached.id, "some-other-message");
  assertThrows(() => service.send("u-1", channel.id, "hi", null, "a-2"), ValidationError);
});

Deno.test("MessageService.send rejects attaching another user's uploaded file", () => {
  const { service, roomRepo, attachments } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });

  attachments.create({
    id: "a-foreign",
    uploaderId: "u-2",
    kind: "attachment",
    fileName: "foreign.png",
    mimeType: "image/png",
    sizeBytes: 10,
    storagePath: "attachments/a-foreign",
  });

  assertThrows(() => service.send("u-1", channel.id, "hi", null, "a-foreign"), ForbiddenError);
});
