import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { DeleteNotificationsHandler } from "../../src/application/websocket/handlers/notifications/deleteNotificationsHandler.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { FakeNotificationRepository } from "../support/fakeNotificationRepository.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";
import type { HandlerContext } from "../../src/application/websocket/eventHandler.ts";

function makeHandler() {
  const notifications = new FakeNotificationRepository();
  const users = new FakeUserRepository();
  const service = new NotificationService(notifications, users);
  const handler = new DeleteNotificationsHandler(service);
  return { handler, notifications };
}

const ctx: HandlerContext = { userId: "u-1", connectionId: "c-1" };

Deno.test("DeleteNotificationsHandler: rejects both ids and all true", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { all: true, ids: ["n-1"] }),
    ValidationError,
    'Provide either "ids" or "all", not both.',
  );
});

Deno.test("DeleteNotificationsHandler: rejects neither ids nor all", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, {}),
    ValidationError,
    'Provide either "ids" or "all".',
  );
});

Deno.test("DeleteNotificationsHandler: rejects all: false", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { all: false }),
    ValidationError,
    'all" must be exactly true.',
  );
});

Deno.test("DeleteNotificationsHandler: rejects all: false with ids", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { all: false, ids: ["n-1"] }),
    ValidationError,
    'Provide either "ids" or "all", not both.',
  );
});

Deno.test("DeleteNotificationsHandler: rejects empty ids array", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { ids: [] }),
    ValidationError,
    '"ids" array must not be empty.',
  );
});

Deno.test("DeleteNotificationsHandler: rejects all: true with empty ids array", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { all: true, ids: [] }),
    ValidationError,
    'Provide either "ids" or "all", not both.',
  );
});

Deno.test("DeleteNotificationsHandler: rejects non-string IDs", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { ids: [123] }),
    ValidationError,
    "must be a string.",
  );
});

Deno.test("DeleteNotificationsHandler: rejects empty-string or whitespace-only IDs", () => {
  const { handler } = makeHandler();
  assertThrows(
    () => handler.handle(ctx, { ids: [""] }),
    ValidationError,
    "must not be empty or whitespace-only.",
  );
  assertThrows(
    () => handler.handle(ctx, { ids: ["   "] }),
    ValidationError,
    "must not be empty or whitespace-only.",
  );
});

Deno.test("DeleteNotificationsHandler: accepts all: true", () => {
  const { handler, notifications } = makeHandler();
  notifications.create({ userId: "u-1", type: "dm", conversationId: "r-1", messageId: "m-1" });
  const res = handler.handle(ctx, { all: true });
  assertEquals(res.deletedCount, 1);
});

Deno.test("DeleteNotificationsHandler: accepts non-empty valid ids array", () => {
  const { handler, notifications } = makeHandler();
  const n = notifications.create({
    userId: "u-1",
    type: "dm",
    conversationId: "r-1",
    messageId: "m-1",
  });
  const res = handler.handle(ctx, { ids: [n.id] });
  assertEquals(res.deletedCount, 1);
});
