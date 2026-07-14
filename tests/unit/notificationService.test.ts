import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { FakeNotificationRepository } from "../support/fakeNotificationRepository.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import type { Conversation } from "../../src/domain/conversations/conversation.entity.ts";
import type { MessageSummary } from "../../src/domain/messages/message.entity.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";

function makeRoom(
  overrides: Partial<Conversation> & { id: string; type: Conversation["type"] },
): Conversation {
  return {
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

function makeMessage(overrides: Partial<MessageSummary> & { id: string }): MessageSummary {
  return {
    conversationId: "room-1",
    authorId: "author",
    content: "",
    replyToId: null,
    isSystem: false,
    edited: false,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

function makeServices() {
  const notifications = new FakeNotificationRepository();
  const users = new FakeUserRepository();
  const service = new NotificationService(notifications, users);
  return { service, notifications, users };
}

Deno.test("NotificationService.notifyForNewMessage: dm room notifies the other member, not the sender", () => {
  const { service } = makeServices();
  const room = makeRoom({ id: "dm-1", type: "dm" });
  const message = makeMessage({ id: "m-1", conversationId: room.id, authorId: "alice" });

  const triggers = service.notifyForNewMessage(room, message, ["alice", "bob"]);

  assertEquals(triggers.length, 1);
  assertEquals(triggers[0]?.userId, "bob");
  assertEquals(triggers[0]?.notification.type, "dm");
  assertEquals(triggers[0]?.notification.conversationId, room.id);
  assertEquals(triggers[0]?.notification.messageId, message.id);
});

Deno.test("NotificationService.notifyForNewMessage: channel/group scans @mentions, excluding self and unknown usernames", () => {
  const { service, users } = makeServices();
  users.create({
    id: "bob-id",
    username: "bob",
    displayName: "Bob",
    email: "bob@example.com",
    passwordHash: "hash",
  });
  users.create({
    id: "alice-id",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });

  const room = makeRoom({ id: "c-1", type: "channel" });
  const message = makeMessage({
    id: "m-1",
    conversationId: room.id,
    authorId: "alice-id",
    content: "hey @bob and @alice and @nobody, check this out",
  });

  const triggers = service.notifyForNewMessage(room, message, []);

  assertEquals(triggers.length, 1); // @alice excluded (self-mention), @nobody unresolvable
  assertEquals(triggers[0]?.userId, "bob-id");
  assertEquals(triggers[0]?.notification.type, "mention");
});

Deno.test("NotificationService.notifyForNewMessage: a dm never also scans for mentions", () => {
  const { service, users } = makeServices();
  users.create({
    id: "bob-id",
    username: "bob",
    displayName: "Bob",
    email: "bob@example.com",
    passwordHash: "hash",
  });
  const room = makeRoom({ id: "dm-1", type: "dm" });
  const message = makeMessage({
    id: "m-1",
    conversationId: room.id,
    authorId: "alice",
    content: "hey @bob",
  });

  const triggers = service.notifyForNewMessage(room, message, ["alice", "bob-id"]);

  assertEquals(triggers.length, 1);
  assertEquals(triggers[0]?.notification.type, "dm"); // not "mention"
});

Deno.test("NotificationService.notifyGroupInvite creates a group_invite notification", () => {
  const { service } = makeServices();
  const trigger = service.notifyGroupInvite("invitee", "group-1");
  assertEquals(trigger.userId, "invitee");
  assertEquals(trigger.notification.type, "group_invite");
  assertEquals(trigger.notification.conversationId, "group-1");
  assertEquals(trigger.notification.messageId, null);
});

Deno.test("NotificationService.notifyReaction notifies the message author, not the reactor, and no-ops on self-reaction", () => {
  const { service } = makeServices();

  const trigger = service.notifyReaction("author", "reactor", "room-1", "m-1");
  assertEquals(trigger?.userId, "author");
  assertEquals(trigger?.notification.type, "reaction");

  assertEquals(service.notifyReaction("same-user", "same-user", "room-1", "m-1"), null);
  assertEquals(service.notifyReaction(null, "reactor", "room-1", "m-1"), null);
});

Deno.test("NotificationService.list/markRead/markAllRead", () => {
  const { service, notifications } = makeServices();
  notifications.create({ userId: "u-1", type: "dm", conversationId: "r-1", messageId: "m-1" });
  notifications.create({ userId: "u-1", type: "mention", conversationId: "r-2", messageId: "m-2" });
  notifications.create({ userId: "u-2", type: "dm", conversationId: "r-1", messageId: "m-3" });

  assertEquals(service.list("u-1", false).length, 2);

  const [first] = service.list("u-1", false);
  service.markRead("u-1", first!.id);
  assertEquals(service.list("u-1", true).length, 1);

  service.markAllRead("u-1");
  assertEquals(service.list("u-1", true).length, 0);
  assertEquals(service.list("u-2", true).length, 1); // unaffected
});

Deno.test("NotificationService.deleteByIds/deleteAll affect only the caller's notifications and report deleted counts", () => {
  const { service, notifications } = makeServices();
  const own1 = notifications.create({
    userId: "u-1",
    type: "dm",
    conversationId: "r-1",
    messageId: "m-1",
  });
  const own2 = notifications.create({
    userId: "u-1",
    type: "mention",
    conversationId: "r-2",
    messageId: "m-2",
  });
  const foreign = notifications.create({
    userId: "u-2",
    type: "dm",
    conversationId: "r-1",
    messageId: "m-3",
  });

  // Foreign and unknown ids are silently skipped, never deleted.
  assertEquals(service.deleteByIds("u-1", [foreign.id, "no-such-id"]), 0);
  assertEquals(service.list("u-2", false).length, 1);

  assertEquals(service.deleteByIds("u-1", [own1.id]), 1);
  assertEquals(service.list("u-1", false).map((n) => n.id), [own2.id]);
  // Idempotent: deleting the same id again counts zero rows.
  assertEquals(service.deleteByIds("u-1", [own1.id]), 0);

  assertEquals(service.deleteAll("u-1"), 1);
  assertEquals(service.list("u-1", false), []);
  assertEquals(service.list("u-2", false).length, 1); // unaffected
});

Deno.test("NotificationService.markRead throws NotFoundError for an unknown id, ForbiddenError for someone else's notification", () => {
  const { service, notifications } = makeServices();
  const notification = notifications.create({
    userId: "owner",
    type: "dm",
    conversationId: "r-1",
    messageId: "m-1",
  });

  assertThrows(() => service.markRead("owner", "no-such-id"), NotFoundError);
  assertThrows(() => service.markRead("someone-else", notification.id), ForbiddenError);
});
