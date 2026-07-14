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
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteConversationReadRepository } from "../../src/storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { ReactionService } from "../../src/domain/reactions/reactionService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { SearchService } from "../../src/domain/search/searchService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { SendMessageHandler } from "../../src/application/websocket/handlers/messages/sendMessageHandler.ts";
import { ToggleReactionHandler } from "../../src/application/websocket/handlers/reactions/toggleReactionHandler.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
import { AddMemberHandler } from "../../src/application/websocket/handlers/groups/addMemberHandler.ts";
import { OpenDmHandler } from "../../src/application/websocket/handlers/dm/openDmHandler.ts";
import { ListNotificationsHandler } from "../../src/application/websocket/handlers/notifications/listNotificationsHandler.ts";
import { MarkNotificationReadHandler } from "../../src/application/websocket/handlers/notifications/markNotificationReadHandler.ts";
import { DeleteNotificationsHandler } from "../../src/application/websocket/handlers/notifications/deleteNotificationsHandler.ts";
import { SearchMessagesHandler } from "../../src/application/websocket/handlers/search/searchMessagesHandler.ts";
import { SearchUsersHandler } from "../../src/application/websocket/handlers/search/searchUsersHandler.ts";
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

/** `message.new`/`reaction.updated` broadcast to the whole room audience, including the
 * sender's own socket — see tests/integration/messages.test.ts for the fuller
 * explanation. The push arrives before the RPC ack, so this drains it first. */
async function sendAndGetAck(queue: WsMessageQueue, echoEvent: string): Promise<WsResponse> {
  const echo = await queue.next() as WsPush;
  if (echo.event !== echoEvent) {
    throw new Error(`expected to drain a self-echo "${echoEvent}", got "${echo.event}"`);
  }
  return await queue.next() as WsResponse;
}

async function bootTestServer(
  options: {
    reactionRateLimit?: { maxTokens: number; refillIntervalMs: number };
    groupCreateRateLimit?: { maxTokens: number; refillIntervalMs: number };
  } = {},
) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-notifications-search");
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
  const roomReadRepository = new SqliteConversationReadRepository(db);
  const reactionRepository = new SqliteReactionRepository(db);
  const attachmentRepository = new SqliteAttachmentRepository(db);
  const notificationRepository = new SqliteNotificationRepository(db);
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
  const permissionService = new PermissionService(roomMemberRepository);
  const rateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const messageService = new MessageService(
    messageRepository,
    roomRepository,
    permissionService,
    rateLimiter,
    transactions,
    reactionRepository,
    attachmentRepository,
  );
  const roomReadService = new ConversationReadService(
    roomReadRepository,
    roomRepository,
    permissionService,
  );
  const reactionService = new ReactionService(
    reactionRepository,
    messageRepository,
    roomRepository,
    permissionService,
  );
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
  const notificationService = new NotificationService(notificationRepository, userRepository);
  const searchService = new SearchService(
    messageRepository,
    messageService,
    roomRepository,
    permissionService,
    userRepository,
  );
  const reactionRateLimiter = new RateLimiter(
    options.reactionRateLimit ?? { maxTokens: 1000, refillIntervalMs: 10_000 },
  );
  const groupCreateRateLimiter = new RateLimiter(
    options.groupCreateRateLimit ?? { maxTokens: 1000, refillIntervalMs: 10_000 },
  );
  const groupMembershipRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const dmOpenRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });

  wsRegistry.register(
    new SendMessageHandler(
      messageService,
      roomReadService,
      roomRepository,
      roomMemberRepository,
      notificationService,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new ToggleReactionHandler(
      reactionService,
      roomRepository,
      roomMemberRepository,
      notificationService,
      reactionRateLimiter,
      connectionManager,
      codec,
    ),
  );
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
  wsRegistry.register(new OpenDmHandler(dmService, dmOpenRateLimiter));
  wsRegistry.register(new ListNotificationsHandler(notificationService));
  wsRegistry.register(new MarkNotificationReadHandler(notificationService));
  wsRegistry.register(new DeleteNotificationsHandler(notificationService));
  wsRegistry.register(new SearchMessagesHandler(searchService));
  wsRegistry.register(new SearchUsersHandler(searchService));

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
    return {
      userId: result.profile.id,
      username: result.profile.username,
      accessToken: result.accessToken,
    };
  }

  function createChannel(slug: string) {
    return roomRepository.create({
      id: crypto.randomUUID(),
      type: "channel",
      slug,
      isPublic: true,
    });
  }

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
    createChannel,
    connectAsSoleUser,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

Deno.test("WS message.send in a DM notifies the other member; notification.list/markRead work", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain "bob came online"

    send(aliceConn.socket, "1", "dm.open", { userId: bob.userId });
    const dmOpenAck = await aliceConn.queue.next() as WsResponse;
    const room = dmOpenAck.data!.room as { id: string };

    send(aliceConn.socket, "2", "message.send", { conversationId: room.id, content: "hey bob" });
    const [, bobPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.new"),
      bobConn.queue.next(), // message.new
    ]);
    assertEquals((bobPush as WsPush).event, "message.new");
    await bobConn.queue.next(); // drain the unread.updated the send also pushes to bob
    const notificationPush = await bobConn.queue.next() as WsPush;
    assertEquals(notificationPush.event, "notification.new");
    const pushedNotification = notificationPush.data.notification as {
      id: string;
      type: string;
      isRead: boolean;
    };
    assertEquals(pushedNotification.type, "dm");
    assertEquals(pushedNotification.isRead, false);

    send(bobConn.socket, "3", "notification.list", {});
    const listAck = await bobConn.queue.next() as WsResponse;
    const notifications = listAck.data!.notifications as Array<{ id: string; type: string }>;
    assertEquals(notifications.length, 1);
    assertEquals(notifications[0]!.type, "dm");
    assertEquals(notifications[0]!.id, pushedNotification.id);

    send(bobConn.socket, "4", "notification.markRead", { notificationId: pushedNotification.id });
    await bobConn.queue.next();

    send(bobConn.socket, "5", "notification.list", { unreadOnly: true });
    const unreadAck = await bobConn.queue.next() as WsResponse;
    assertEquals(unreadAck.data!.notifications, []);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS notification.delete removes selected or all own notifications and never another user's", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain "bob came online"

    send(aliceConn.socket, "1", "dm.open", { userId: bob.userId });
    const dmOpenAck = await aliceConn.queue.next() as WsResponse;
    const room = dmOpenAck.data!.room as { id: string };

    // Two DM messages -> two notifications for bob.
    const notificationIds: string[] = [];
    for (const [requestId, content] of [["2", "first"], ["3", "second"]] as const) {
      send(aliceConn.socket, requestId, "message.send", { conversationId: room.id, content });
      await sendAndGetAck(aliceConn.queue, "message.new");
      await bobConn.queue.next(); // message.new
      await bobConn.queue.next(); // unread.updated
      const push = await bobConn.queue.next() as WsPush;
      assertEquals(push.event, "notification.new");
      notificationIds.push((push.data.notification as { id: string }).id);
    }

    // Alice cannot delete bob's notifications: scoped delete reports 0 rows.
    send(aliceConn.socket, "4", "notification.delete", { ids: notificationIds });
    const foreignAck = await aliceConn.queue.next() as WsResponse;
    assertEquals(foreignAck.success, true);
    assertEquals(foreignAck.data!.deletedCount, 0);

    // Bob deletes one selected notification; the other one survives.
    send(bobConn.socket, "5", "notification.delete", { ids: [notificationIds[0]!] });
    const selectedAck = await bobConn.queue.next() as WsResponse;
    assertEquals(selectedAck.data!.deletedCount, 1);

    send(bobConn.socket, "6", "notification.list", {});
    const listAck = await bobConn.queue.next() as WsResponse;
    assertEquals(
      (listAck.data!.notifications as Array<{ id: string }>).map((n) => n.id),
      [notificationIds[1]!],
    );

    // Deleting the same id again is an idempotent no-op.
    send(bobConn.socket, "7", "notification.delete", { ids: [notificationIds[0]!] });
    const repeatAck = await bobConn.queue.next() as WsResponse;
    assertEquals(repeatAck.data!.deletedCount, 0);

    // "all: true" clears the rest; an empty payload is a validation error.
    send(bobConn.socket, "8", "notification.delete", { all: true });
    const allAck = await bobConn.queue.next() as WsResponse;
    assertEquals(allAck.data!.deletedCount, 1);

    send(bobConn.socket, "9", "notification.list", {});
    const emptyAck = await bobConn.queue.next() as WsResponse;
    assertEquals(emptyAck.data!.notifications, []);

    send(bobConn.socket, "10", "notification.delete", {});
    const invalidAck = await bobConn.queue.next() as WsResponse;
    assertEquals(invalidAck.success, false);
    assertEquals(invalidAck.error!.code, "VALIDATION_ERROR");

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS message.send with an @mention in a channel notifies the mentioned user, not an unresolvable username", async () => {
  const { registerUser, createChannel, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("mentions-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain "bob came online"

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: `hey @${bob.username} and @no_such_user_at_all, check this`,
    });
    await sendAndGetAck(aliceConn.queue, "message.new");
    await bobConn.queue.next(); // message.new
    await bobConn.queue.next(); // drain the unread.updated the send also pushes to bob

    const notificationPush = await bobConn.queue.next() as WsPush;
    assertEquals(notificationPush.event, "notification.new");
    assertEquals((notificationPush.data.notification as { type: string }).type, "mention");

    // No further notification.new arrives for the unresolvable @mention — the next
    // thing on the wire (if anything) would not be another notification.new.
    send(bobConn.socket, "2", "notification.list", {});
    const listAck = await bobConn.queue.next() as WsResponse;
    assertEquals((listAck.data!.notifications as unknown[]).length, 1);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group.create/group.addMember notify invited members with group_invite", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const carol = await registerUser("carol");
    const dana = await registerUser("dana");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    const carolConn = await connectAsSoleUser(carol.accessToken);
    const danaConn = await connectAsSoleUser(dana.accessToken);
    await aliceConn.queue.next(); // bob online
    await aliceConn.queue.next(); // carol online
    await aliceConn.queue.next(); // dana online
    await bobConn.queue.next(); // carol online
    await bobConn.queue.next(); // dana online
    await carolConn.queue.next(); // dana online

    send(aliceConn.socket, "1", "group.create", {
      name: "Trip Planning",
      memberIds: [bob.userId, carol.userId],
    });
    // group.create broadcasts a system message.new + room.updated to every member
    // (including the caller) before the ack — see tests/integration/rooms.test.ts.
    await aliceConn.queue.next(); // system message.new self-echo
    await aliceConn.queue.next(); // room.updated self-echo
    const createAck = await aliceConn.queue.next() as WsResponse;
    const group = createAck.data!.room as { id: string };

    await bobConn.queue.next(); // system message.new
    await bobConn.queue.next(); // room.updated
    const bobNotification = await bobConn.queue.next() as WsPush;
    assertEquals(bobNotification.event, "notification.new");
    assertEquals((bobNotification.data.notification as { type: string }).type, "group_invite");
    await carolConn.queue.next(); // system message.new
    await carolConn.queue.next(); // room.updated
    const carolNotification = await carolConn.queue.next() as WsPush;
    assertEquals((carolNotification.data.notification as { type: string }).type, "group_invite");

    send(aliceConn.socket, "2", "group.addMember", { groupId: group.id, userId: dana.userId });
    await aliceConn.queue.next(); // system message.new self-echo
    await aliceConn.queue.next(); // room.updated self-echo
    await aliceConn.queue.next(); // ack
    await bobConn.queue.next(); // system message.new (bob is still a member)
    await bobConn.queue.next(); // room.updated
    await carolConn.queue.next(); // system message.new (carol is still a member)
    await carolConn.queue.next(); // room.updated

    send(bobConn.socket, "3", "notification.list", {});
    const bobList = await bobConn.queue.next() as WsResponse;
    assertEquals((bobList.data!.notifications as unknown[]).length, 1); // only bob's own invite

    aliceConn.socket.close();
    bobConn.socket.close();
    carolConn.socket.close();
    danaConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS reaction.toggle notifies the message author on add (not remove, not self-reaction)", async () => {
  const { registerUser, createChannel, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("reactions-notify-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // bob online

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "react to this",
    });
    const sendAck = await sendAndGetAck(aliceConn.queue, "message.new");
    const messageId = (sendAck.data!.message as { id: string }).id;
    await bobConn.queue.next(); // message.new
    await bobConn.queue.next(); // drain the unread.updated the send also pushes to bob

    // Bob reacts -> alice (the author) gets notified.
    send(bobConn.socket, "2", "reaction.toggle", { messageId, emoji: "👍" });
    const [, aliceReactionPush] = await Promise.all([
      sendAndGetAck(bobConn.queue, "reaction.updated"),
      aliceConn.queue.next(), // reaction.updated
    ]);
    assertEquals((aliceReactionPush as WsPush).event, "reaction.updated");
    const aliceNotification = await aliceConn.queue.next() as WsPush;
    assertEquals(aliceNotification.event, "notification.new");
    assertEquals((aliceNotification.data.notification as { type: string }).type, "reaction");

    // Bob un-reacts -> no additional notification for alice.
    send(bobConn.socket, "3", "reaction.toggle", { messageId, emoji: "👍" });
    await Promise.all([
      sendAndGetAck(bobConn.queue, "reaction.updated"),
      aliceConn.queue.next(), // reaction.updated only, no notification.new follows
    ]);

    // Alice reacts to her own message -> no self-notification.
    send(aliceConn.socket, "4", "reaction.toggle", { messageId, emoji: "🎉" });
    await sendAndGetAck(aliceConn.queue, "reaction.updated");
    await bobConn.queue.next(); // bob still observes the reaction.updated broadcast

    send(aliceConn.socket, "5", "notification.list", {});
    const aliceList = await aliceConn.queue.next() as WsResponse;
    assertEquals((aliceList.data!.notifications as unknown[]).length, 1); // only the one from bob

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS search.messages: scoped to the room, and denies a non-member of a group", async () => {
  const { registerUser, createChannel, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("search-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const stranger = await registerUser("stranger");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain "bob came online"

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "the quick brown fox",
    });
    const [, bobPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.new"),
      bobConn.queue.next(), // message.new
    ]);
    assertEquals((bobPush as WsPush).event, "message.new");
    await bobConn.queue.next(); // drain the unread.updated the send also pushes to bob

    send(aliceConn.socket, "2", "search.messages", { conversationId: channel.id, query: "quick" });
    const searchAck = await aliceConn.queue.next() as WsResponse;
    const found = searchAck.data!.messages as Array<{ content: string }>;
    assertEquals(found.length, 1);
    assertEquals(found[0]!.content, "the quick brown fox");

    // group.create with alice + bob only has 2 total members, below MIN_GROUP_MEMBERS —
    // add a throwaway third member so the group actually gets created.
    const throwaway = await registerUser("throwaway");
    send(aliceConn.socket, "3", "group.create", {
      name: "Private Group",
      memberIds: [bob.userId, throwaway.userId],
    });
    await aliceConn.queue.next(); // system message.new self-echo
    await aliceConn.queue.next(); // room.updated self-echo
    const createAck = await aliceConn.queue.next() as WsResponse;
    const group = createAck.data!.room as { id: string };
    await bobConn.queue.next(); // system message.new
    await bobConn.queue.next(); // room.updated
    await bobConn.queue.next(); // bob's group_invite notification.new (unused here)

    const strangerConn = await connectAsSoleUser(stranger.accessToken);
    send(strangerConn.socket, "1", "search.messages", { conversationId: group.id, query: "x" });
    const strangerAck = await strangerConn.queue.next() as WsResponse;
    assertEquals(strangerAck.success, false);
    assertEquals(strangerAck.error!.code, "FORBIDDEN");

    aliceConn.socket.close();
    bobConn.socket.close();
    strangerConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS search.users matches by username or display name substring", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    send(aliceConn.socket, "1", "search.users", { query: "alice" });
    const ack = await aliceConn.queue.next() as WsResponse;
    const users = ack.data!.users as Array<{ username: string }>;
    assertEquals(users.some((u) => u.username === alice.username), true);

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS reaction.toggle is rate-limited: RATE_LIMITED after exceeding the bucket", async () => {
  const { registerUser, createChannel, connectAsSoleUser, cleanup } = await bootTestServer({
    reactionRateLimit: { maxTokens: 2, refillIntervalMs: 10_000 },
  });
  try {
    const channel = createChannel("rate-limit-reactions");
    const alice = await registerUser("alice");
    const aliceConn = await connectAsSoleUser(alice.accessToken);

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "react to me",
    });
    const sendAck = await sendAndGetAck(aliceConn.queue, "message.new");
    const messageId = (sendAck.data!.message as { id: string }).id;

    send(aliceConn.socket, "2", "reaction.toggle", { messageId, emoji: "👍" });
    assertEquals((await sendAndGetAck(aliceConn.queue, "reaction.updated")).success, true);
    send(aliceConn.socket, "3", "reaction.toggle", { messageId, emoji: "👍" });
    assertEquals((await sendAndGetAck(aliceConn.queue, "reaction.updated")).success, true);

    send(aliceConn.socket, "4", "reaction.toggle", { messageId, emoji: "👍" });
    const limited = await aliceConn.queue.next() as WsResponse;
    assertEquals(limited.success, false);
    assertEquals(limited.error!.code, "RATE_LIMITED");

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS group.create is rate-limited: RATE_LIMITED after exceeding the bucket", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer({
    groupCreateRateLimit: { maxTokens: 1, refillIntervalMs: 10_000 },
  });
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const carol = await registerUser("carol");
    const dana = await registerUser("dana");
    const aliceConn = await connectAsSoleUser(alice.accessToken);

    send(aliceConn.socket, "1", "group.create", {
      name: "G1",
      memberIds: [bob.userId, carol.userId],
    });
    await aliceConn.queue.next(); // system message.new self-echo
    await aliceConn.queue.next(); // room.updated self-echo
    const firstAck = await aliceConn.queue.next() as WsResponse;
    assertEquals(firstAck.success, true);

    send(aliceConn.socket, "2", "group.create", {
      name: "G2",
      memberIds: [bob.userId, dana.userId],
    });
    const limited = await aliceConn.queue.next() as WsResponse;
    assertEquals(limited.success, false);
    assertEquals(limited.error!.code, "RATE_LIMITED");

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});
