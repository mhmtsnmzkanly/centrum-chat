import { assertEquals } from "jsr:@std/assert@1";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";

function makeService() {
  const users = new FakeUserRepository();
  const user = users.create({
    id: "u-1",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });
  return { users, user, presence: new PresenceService(users) };
}

Deno.test("PresenceService.handleConnect: not a transition when not the first connection", () => {
  const { presence } = makeService();
  assertEquals(presence.handleConnect("u-1", false), null);
});

Deno.test("PresenceService.handleConnect: marks the user online on the first connection", () => {
  const { users, presence } = makeService();
  const transition = presence.handleConnect("u-1", true);

  assertEquals(transition, { userId: "u-1", status: "online", lastSeenAt: null });
  assertEquals(users.findById("u-1")?.status, "online");
});

Deno.test("PresenceService.handleDisconnect: not a transition when not the last connection", () => {
  const { presence } = makeService();
  assertEquals(presence.handleDisconnect("u-1", false), null);
});

Deno.test("PresenceService.handleDisconnect: marks the user offline with lastSeenAt on the last disconnect", () => {
  const { users, presence } = makeService();
  const transition = presence.handleDisconnect("u-1", true);

  assertEquals(transition?.userId, "u-1");
  assertEquals(transition?.status, "offline");
  assertEquals(typeof transition?.lastSeenAt, "string");
  assertEquals(users.findById("u-1")?.status, "offline");
  assertEquals(users.findById("u-1")?.lastSeenAt, transition?.lastSeenAt);
});

Deno.test("PresenceService.updateStatus: going offline sets lastSeenAt", () => {
  const { users, presence } = makeService();
  const transition = presence.updateStatus("u-1", "offline");

  assertEquals(transition.status, "offline");
  assertEquals(typeof transition.lastSeenAt, "string");
  assertEquals(users.findById("u-1")?.lastSeenAt, transition.lastSeenAt);
});

Deno.test("PresenceService.updateStatus: going online/idle/dnd leaves lastSeenAt null in the transition", () => {
  const { presence } = makeService();
  assertEquals(presence.updateStatus("u-1", "online").lastSeenAt, null);
  assertEquals(presence.updateStatus("u-1", "idle").lastSeenAt, null);
  assertEquals(presence.updateStatus("u-1", "dnd").lastSeenAt, null);
});
