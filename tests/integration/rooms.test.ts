import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { send, waitForOpen, WsMessageQueue } from "../support/wsTestClient.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PreferencesService } from "../../src/domain/preferences/preferencesService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { ChannelService } from "../../src/domain/conversations/channelService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { UpdatePreferencesHandler } from "../../src/application/websocket/handlers/profile/updatePreferencesHandler.ts";
import { ListChannelsHandler } from "../../src/application/websocket/handlers/channels/listChannelsHandler.ts";
import { ListGroupsHandler } from "../../src/application/websocket/handlers/groups/listGroupsHandler.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
import { AddMemberHandler } from "../../src/application/websocket/handlers/groups/addMemberHandler.ts";
import { RemoveMemberHandler } from "../../src/application/websocket/handlers/groups/removeMemberHandler.ts";
import { LeaveGroupHandler } from "../../src/application/websocket/handlers/groups/leaveGroupHandler.ts";
import { OpenDmHandler } from "../../src/application/websocket/handlers/dm/openDmHandler.ts";
import { ListDmHandler } from "../../src/application/websocket/handlers/dm/listDmHandler.ts";
import { createPresenceAwareConnectionManager } from "../support/testConnectionManager.ts";

interface WsResponse {
  readonly id: string;
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { code: string };
}

interface WsPush {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** group.create/addMember/removeMember/leave broadcast a system `message.new` and a
 * `room.updated` to every current member, including the caller, before the RPC ack —
 * same self-echo-before-ack ordering documented in tests/integration/messages.test.ts.
 * Drains both and returns them alongside the ack. */
async function drainGroupMutationPushes(
  queue: WsMessageQueue,
): Promise<{ systemMessage: WsPush; roomUpdated: WsPush; ack: WsResponse }> {
  const systemMessage = await queue.next() as WsPush;
  const roomUpdated = await queue.next() as WsPush;
  const ack = await queue.next() as WsResponse;
  return { systemMessage, roomUpdated, ack };
}

async function bootTestServer() {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-rooms");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });

  const userRepository = new SqliteUserRepository(db);
  const preferencesRepository = new SqlitePreferencesRepository(db);
  const roomRepository = new SqliteConversationRepository(db);
  const roomMemberRepository = new SqliteConversationMembershipRepository(db);
  const directConversationPairRepository = new SqliteDirectConversationPairRepository(db);
  const messageRepository = new SqliteMessageRepository(db);
  const reactionRepository = new SqliteReactionRepository(db);
  const attachmentRepository = new SqliteAttachmentRepository(db);
  const transactions = new SqliteTransactionManager(db);

  const authService = new AuthService(
    userRepository,
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );
  const presenceService = new PresenceService(userRepository);
  const connectionManager = createPresenceAwareConnectionManager(presenceService, codec);
  const preferencesService = new PreferencesService(preferencesRepository);
  const channelService = new ChannelService(roomRepository);
  const groupService = new GroupService(
    roomRepository,
    roomMemberRepository,
    userRepository,
    preferencesRepository,
  );
  const dmService = new DmService(
    roomRepository,
    roomMemberRepository,
    directConversationPairRepository,
    userRepository,
    preferencesRepository,
    transactions,
  );
  const notificationService = new NotificationService(
    new SqliteNotificationRepository(db),
    userRepository,
  );
  const permissionService = new PermissionService(roomMemberRepository);
  const messageService = new MessageService(
    messageRepository,
    roomRepository,
    permissionService,
    new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 }),
    transactions,
    reactionRepository,
    attachmentRepository,
  );
  const groupCreateRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const groupMembershipRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const dmOpenRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });

  wsRegistry.register(new UpdatePreferencesHandler(preferencesService));
  wsRegistry.register(new ListChannelsHandler(channelService));
  wsRegistry.register(new ListGroupsHandler(groupService));
  wsRegistry.register(
    new CreateGroupHandler(
      groupService,
      messageService,
      roomRepository,
      roomMemberRepository,
      notificationService,
      transactions,
      groupCreateRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new AddMemberHandler(
      groupService,
      messageService,
      roomRepository,
      roomMemberRepository,
      notificationService,
      transactions,
      groupMembershipRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new RemoveMemberHandler(
      groupService,
      messageService,
      roomRepository,
      roomMemberRepository,
      transactions,
      groupMembershipRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new LeaveGroupHandler(
      groupService,
      messageService,
      roomRepository,
      roomMemberRepository,
      transactions,
      groupMembershipRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(new OpenDmHandler(dmService, dmOpenRateLimiter));
  wsRegistry.register(new ListDmHandler(dmService));

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    wsUpgrade: (request, clientIp) =>
      handleWsUpgrade(request, {
        clientIp,
        registry: wsRegistry,
        connectionManager,
        codec,
        logger,
        tokenService,
      }),
  });
  const port = (server.addr as Deno.NetAddr).port;

  async function registerUser(label: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const result = await authService.register({
      username: `${label}_${suffix}`,
      email: `${label}_${suffix}@example.com`,
      password: "correct-horse-battery",
      displayName: `${label} display`,
    });
    return { userId: result.profile.id, accessToken: result.accessToken };
  }

  /** Connects, attaches a message queue from before "open" resolves (no drop window),
   * and drains the connection's own "I just came online" presence.updated push. */
  async function connectAsSoleUser(
    accessToken: string,
  ): Promise<{ socket: WebSocket; queue: WsMessageQueue }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${accessToken}`);
    const queue = new WsMessageQueue(socket);
    await waitForOpen(socket);
    await queue.next(); // drain the own-online presence push
    return { socket, queue };
  }

  return {
    registerUser,
    connectAsSoleUser,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

Deno.test("WS channel.list returns the 4 seeded public channels with a null memberCount", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const { accessToken } = await registerUser("alice");
    const { socket, queue } = await connectAsSoleUser(accessToken);

    send(socket, "1", "channel.list", {});
    const response = await queue.next() as WsResponse;
    assertEquals(response.success, true);
    const channels = response.data!.channels as Array<{ slug: string; memberCount: null }>;
    assertEquals(channels.length, 4);
    assertEquals(channels.map((c) => c.slug).sort(), [
      "gaming",
      "general",
      "programming",
      "technology",
    ]);
    assertEquals(channels.every((c) => c.memberCount === null), true);

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group lifecycle: create -> list -> addMember -> removeMember -> leave (deletes the room)", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const owner = await registerUser("owner");
    const member1 = await registerUser("member1");
    const member2 = await registerUser("member2");
    const newbie = await registerUser("newbie");

    const { socket, queue } = await connectAsSoleUser(owner.accessToken);

    send(socket, "1", "group.create", {
      name: "Test Group",
      memberIds: [member1.userId, member2.userId],
    });
    const created = await drainGroupMutationPushes(queue);
    assertEquals(created.systemMessage.event, "message.new");
    assertEquals((created.systemMessage.data.message as { isSystem: boolean }).isSystem, true);
    assertEquals(created.roomUpdated.event, "room.updated");
    assertEquals(created.ack.success, true);
    const room = created.ack.data!.room as { id: string; memberCount: number };
    assertEquals(room.memberCount, 3);
    assertEquals((created.roomUpdated.data.room as { id: string }).id, room.id);

    send(socket, "2", "group.list", {});
    const listResponse = await queue.next() as WsResponse;
    assertEquals(listResponse.success, true);
    assertEquals((listResponse.data!.groups as unknown[]).length, 1);

    // group.addMember/removeMember/leave all respond with `{}` per
    // docs/03-websocket-events.md; membership-count effects are observed via group.list.
    send(socket, "3", "group.addMember", { groupId: room.id, userId: newbie.userId });
    const added = await drainGroupMutationPushes(queue);
    assertEquals(added.systemMessage.event, "message.new");
    assertEquals(added.roomUpdated.event, "room.updated");
    assertEquals(added.ack.success, true);
    assertEquals(added.ack.data, {});

    send(socket, "3b", "group.list", {});
    const afterAddResponse = await queue.next() as WsResponse;
    const groupsAfterAdd = afterAddResponse.data!.groups as Array<{ memberCount: number }>;
    assertEquals(groupsAfterAdd[0]?.memberCount, 4);

    send(socket, "4", "group.removeMember", { groupId: room.id, userId: newbie.userId });
    const removed = await drainGroupMutationPushes(queue);
    assertEquals(removed.systemMessage.event, "message.new");
    assertEquals(removed.roomUpdated.event, "room.updated");
    assertEquals(removed.ack.success, true);
    assertEquals(removed.ack.data, {});

    send(socket, "4b", "group.list", {});
    const afterRemoveResponse = await queue.next() as WsResponse;
    const groupsAfterRemove = afterRemoveResponse.data!.groups as Array<{ memberCount: number }>;
    assertEquals(groupsAfterRemove[0]?.memberCount, 3);

    // The owner leaves, but 2 members remain (ownership transfers) — since the leaver
    // is no longer a member by the time the broadcast fires, there's no self-echo here.
    send(socket, "5", "group.leave", { groupId: room.id });
    const leaveResponse = await queue.next() as WsResponse;
    assertEquals(leaveResponse.success, true);
    assertEquals(leaveResponse.data, {});

    // owner left; group.list for the (now former) owner should show no groups.
    send(socket, "6", "group.list", {});
    const afterLeaveResponse = await queue.next() as WsResponse;
    assertEquals((afterLeaveResponse.data!.groups as unknown[]).length, 0);

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group.removeMember also pushes room.updated directly to the removed member", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const owner = await registerUser("owner");
    const member1 = await registerUser("member1");
    const removed = await registerUser("removed");

    const ownerConn = await connectAsSoleUser(owner.accessToken);
    const removedConn = await connectAsSoleUser(removed.accessToken);
    await ownerConn.queue.next(); // "removed came online"

    send(ownerConn.socket, "1", "group.create", {
      name: "Kick Test",
      memberIds: [member1.userId, removed.userId],
    });
    const created = await drainGroupMutationPushes(ownerConn.queue);
    const room = created.ack.data!.room as { id: string };
    await removedConn.queue.next(); // system message.new
    await removedConn.queue.next(); // room.updated
    await removedConn.queue.next(); // removed's own group_invite notification.new

    send(ownerConn.socket, "2", "group.removeMember", { groupId: room.id, userId: removed.userId });
    const afterRemove = await drainGroupMutationPushes(ownerConn.queue);
    assertEquals(afterRemove.ack.success, true);

    // The removed member is no longer part of room_members, so they don't get the
    // system message/room.updated broadcast — but they do get a direct room.updated
    // telling them about it (docs/03-websocket-events.md "for removal, the removed").
    const removedPush = await removedConn.queue.next() as WsPush;
    assertEquals(removedPush.event, "room.updated");
    assertEquals((removedPush.data.room as { id: string }).id, room.id);

    ownerConn.socket.close();
    removedConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group.leave deletes the room and broadcasts nothing when the last member leaves", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const owner = await registerUser("owner");
    const member1 = await registerUser("member1");
    const member2 = await registerUser("member2");

    const ownerConn = await connectAsSoleUser(owner.accessToken);
    send(ownerConn.socket, "1", "group.create", {
      name: "Solo Group",
      memberIds: [member1.userId, member2.userId],
    });
    const created = await drainGroupMutationPushes(ownerConn.queue);
    const room = created.ack.data!.room as { id: string };

    send(ownerConn.socket, "2", "group.removeMember", { groupId: room.id, userId: member1.userId });
    await drainGroupMutationPushes(ownerConn.queue);
    send(ownerConn.socket, "3", "group.removeMember", { groupId: room.id, userId: member2.userId });
    await drainGroupMutationPushes(ownerConn.queue);

    // Owner is now the last member; leaving deletes the room with no one left to notify.
    send(ownerConn.socket, "4", "group.leave", { groupId: room.id });
    const leaveAck = await ownerConn.queue.next() as WsResponse;
    assertEquals(leaveAck.success, true);

    send(ownerConn.socket, "5", "group.list", {});
    const afterLeave = await ownerConn.queue.next() as WsResponse;
    assertEquals((afterLeave.data!.groups as unknown[]).length, 0);

    ownerConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group.create rejects a too-small group with VALIDATION_ERROR", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const owner = await registerUser("owner");
    const onlyMember = await registerUser("only");
    const { socket, queue } = await connectAsSoleUser(owner.accessToken);

    send(socket, "1", "group.create", { name: "Too Small", memberIds: [onlyMember.userId] });
    const response = await queue.next() as WsResponse;
    assertEquals(response.success, false);
    assertEquals(response.error!.code, "VALIDATION_ERROR");

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS dm.open gets-or-creates the canonical DM room and dm.list reflects it", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const { socket, queue } = await connectAsSoleUser(alice.accessToken);

    send(socket, "1", "dm.open", { userId: bob.userId });
    const firstOpen = await queue.next() as WsResponse;
    assertEquals(firstOpen.success, true);
    const room = firstOpen.data!.room as { id: string; type: string; memberCount: number };
    assertEquals(room.type, "dm");
    assertEquals(room.memberCount, 2);

    send(socket, "2", "dm.open", { userId: bob.userId });
    const secondOpen = await queue.next() as WsResponse;
    assertEquals((secondOpen.data!.room as { id: string }).id, room.id);

    send(socket, "3", "dm.list", {});
    const listResponse = await queue.next() as WsResponse;
    const rooms = listResponse.data!.rooms as Array<{ id: string }>;
    assertEquals(rooms.length, 1);
    assertEquals(rooms[0]!.id, room.id);

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS dm.open is rejected with FORBIDDEN once the target sets dmPrivacy to no_one", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const bobConnection = await connectAsSoleUser(bob.accessToken);
    send(bobConnection.socket, "1", "preferences.update", { dmPrivacy: "no_one" });
    const prefsResponse = await bobConnection.queue.next() as WsResponse;
    assertEquals(prefsResponse.success, true);
    assertEquals(
      (prefsResponse.data!.preferences as { dmPrivacy: string }).dmPrivacy,
      "no_one",
    );

    const aliceConnection = await connectAsSoleUser(alice.accessToken);
    send(aliceConnection.socket, "1", "dm.open", { userId: bob.userId });
    const dmResponse = await aliceConnection.queue.next() as WsResponse;
    assertEquals(dmResponse.success, false);
    assertEquals(dmResponse.error!.code, "FORBIDDEN");

    bobConnection.socket.close();
    aliceConnection.socket.close();
  } finally {
    await cleanup();
  }
});
