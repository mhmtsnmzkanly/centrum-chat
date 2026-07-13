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
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { ReactionService } from "../../src/domain/reactions/reactionService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { TypingService } from "../../src/domain/typing/typingService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { outboundPush } from "../../src/protocol/envelopes.ts";
import { pushToRoomAudience } from "../../src/application/websocket/conversationFanout.ts";
import { ToggleReactionHandler } from "../../src/application/websocket/handlers/reactions/toggleReactionHandler.ts";
import { TypingStartHandler } from "../../src/application/websocket/handlers/typing/typingStartHandler.ts";
import { TypingStopHandler } from "../../src/application/websocket/handlers/typing/typingStopHandler.ts";
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

/**
 * `reaction.updated`/`typing.updated` broadcast to every audience member *including the
 * sender* (pushToRoomAudience for a channel room is connectionManager.broadcastToAll,
 * which includes the caller's own socket). Since the push is sent from inside the
 * handler and the RPC ack is sent afterward by connection.ts, the sender's own socket
 * always sees [self-echo push, ack] in that order. This helper drains the self-echo and
 * returns the ack.
 */
async function sendAndGetAck(queue: WsMessageQueue, echoEvent: string): Promise<WsResponse> {
  const echo = await queue.next() as WsPush;
  if (echo.event !== echoEvent) {
    throw new Error(`expected to drain a self-echo "${echoEvent}", got "${echo.event}"`);
  }
  return await queue.next() as WsResponse;
}

async function bootTestServer(typingExpiryMs = 100) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-reactions-typing");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });

  const userRepository = new SqliteUserRepository(db);
  const roomRepository = new SqliteConversationRepository(db);
  const roomMemberRepository = new SqliteConversationMembershipRepository(db);
  const messageRepository = new SqliteMessageRepository(db);
  const reactionRepository = new SqliteReactionRepository(db);

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
  const reactionService = new ReactionService(
    reactionRepository,
    messageRepository,
    roomRepository,
    permissionService,
  );
  const notificationService = new NotificationService(
    new SqliteNotificationRepository(db),
    userRepository,
  );
  const reactionRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  // A short expiry keeps the auto-expiry test fast instead of waiting a real 6s.
  const typingService = new TypingService(
    (transition) => {
      const room = roomRepository.findById(transition.conversationId);
      if (!room) return;
      pushToRoomAudience(
        room,
        codec.encode(outboundPush("typing.updated", transition)),
        connectionManager,
        roomMemberRepository,
      );
    },
    undefined,
    typingExpiryMs,
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
    new TypingStartHandler(
      typingService,
      roomRepository,
      roomMemberRepository,
      permissionService,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new TypingStopHandler(
      typingService,
      roomRepository,
      roomMemberRepository,
      permissionService,
      connectionManager,
      codec,
    ),
  );

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

  function createChannel(slug: string) {
    return roomRepository.create({
      id: crypto.randomUUID(),
      type: "channel",
      slug,
      isPublic: true,
    });
  }

  function createGroupWithMember(memberUserId: string) {
    const room = roomRepository.create({ id: crypto.randomUUID(), type: "group", isPublic: false });
    roomMemberRepository.add(room.id, memberUserId, "member");
    return room;
  }

  function sendMessage(conversationId: string, authorId: string, content: string) {
    return messageRepository.create({
      id: crypto.randomUUID(),
      conversationId,
      authorId,
      content,
      replyToId: null,
      isSystem: false,
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
    connectAsSoleUser,
    createChannel,
    createGroupWithMember,
    sendMessage,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

Deno.test("WS reaction.toggle: adds then removes, broadcasts reaction.updated to the room", async () => {
  const { registerUser, connectAsSoleUser, createChannel, sendMessage, cleanup } =
    await bootTestServer();
  try {
    const channel = createChannel("reactions-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const message = sendMessage(channel.id, alice.userId, "react to this");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain the "bob came online" presence push

    send(aliceConn.socket, "1", "reaction.toggle", { messageId: message.id, emoji: "👍" });
    const [ackResponse, bobPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "reaction.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(ackResponse.success, true);
    assertEquals(ackResponse.data!.reactions, [{ emoji: "👍", userIds: [alice.userId] }]);
    assertEquals(bobPush.event, "reaction.updated");
    assertEquals(bobPush.data.reactions, [{ emoji: "👍", userIds: [alice.userId] }]);

    send(aliceConn.socket, "2", "reaction.toggle", { messageId: message.id, emoji: "👍" });
    const [toggleOffAck, bobPush2] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "reaction.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(toggleOffAck.data!.reactions, []);
    assertEquals(bobPush2.data.reactions, []);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS reaction.toggle rejects a non-emoji (markup) value with VALIDATION_ERROR", async () => {
  const { registerUser, connectAsSoleUser, createChannel, sendMessage, cleanup } =
    await bootTestServer();
  try {
    const channel = createChannel("reactions-xss");
    const alice = await registerUser("alice");
    const message = sendMessage(channel.id, alice.userId, "react to this");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    send(aliceConn.socket, "1", "reaction.toggle", {
      messageId: message.id,
      emoji: "<b>x</b>",
    });
    const response = await aliceConn.queue.next() as WsResponse;
    assertEquals(response.success, false);
    assertEquals(response.error!.code, "VALIDATION_ERROR");

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS reaction.toggle denies a non-member of a group", async () => {
  const { registerUser, connectAsSoleUser, createGroupWithMember, sendMessage, cleanup } =
    await bootTestServer();
  try {
    const member = await registerUser("member");
    const stranger = await registerUser("stranger");
    const group = createGroupWithMember(member.userId);
    const message = sendMessage(group.id, member.userId, "members only");

    const strangerConn = await connectAsSoleUser(stranger.accessToken);
    send(strangerConn.socket, "1", "reaction.toggle", { messageId: message.id, emoji: "👍" });
    const response = await strangerConn.queue.next() as WsResponse;
    assertEquals(response.success, false);
    assertEquals(response.error!.code, "FORBIDDEN");

    strangerConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS typing.start/typing.stop: broadcasts typing.updated, and auto-expires after silence", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer(100);
  try {
    const channel = createChannel("typing-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain the "bob came online" presence push

    send(aliceConn.socket, "1", "typing.start", { conversationId: channel.id });
    const [startAck, bobStartPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "typing.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(startAck.success, true);
    assertEquals(bobStartPush.event, "typing.updated");
    assertEquals(bobStartPush.data, {
      conversationId: channel.id,
      userId: alice.userId,
      isTyping: true,
    });

    send(aliceConn.socket, "2", "typing.stop", { conversationId: channel.id });
    const [stopAck, bobStopPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "typing.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(stopAck.success, true);
    assertEquals(bobStopPush.data, {
      conversationId: channel.id,
      userId: alice.userId,
      isTyping: false,
    });

    // Start again and let it auto-expire (100ms configured expiry) without a stop.
    send(aliceConn.socket, "3", "typing.start", { conversationId: channel.id });
    await sendAndGetAck(aliceConn.queue, "typing.updated"); // self-echo + ack
    await bobConn.queue.next(); // isTyping:true push

    const bobExpiryPush = await bobConn.queue.next(1000) as WsPush;
    assertEquals(bobExpiryPush.event, "typing.updated");
    assertEquals(bobExpiryPush.data, {
      conversationId: channel.id,
      userId: alice.userId,
      isTyping: false,
    });

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});
