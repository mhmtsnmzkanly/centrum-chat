import { assert, assertEquals } from "jsr:@std/assert@1";
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
import { SqliteConversationReadRepository } from "../../src/storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SendMessageHandler } from "../../src/application/websocket/handlers/messages/sendMessageHandler.ts";
import { EditMessageHandler } from "../../src/application/websocket/handlers/messages/editMessageHandler.ts";
import { DeleteMessageHandler } from "../../src/application/websocket/handlers/messages/deleteMessageHandler.ts";
import { MessageHistoryHandler } from "../../src/application/websocket/handlers/messages/messageHistoryHandler.ts";
import { MarkReadHandler } from "../../src/application/websocket/handlers/messages/markReadHandler.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
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

async function bootTestServer(rateLimit = { maxTokens: 1000, refillIntervalMs: 10_000 }) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-messages");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });

  const userRepository = new SqliteUserRepository(db);
  const roomRepository = new SqliteConversationRepository(db);
  const roomMemberRepository = new SqliteConversationMembershipRepository(db);
  const messageRepository = new SqliteMessageRepository(db);
  const roomReadRepository = new SqliteConversationReadRepository(db);
  const reactionRepository = new SqliteReactionRepository(db);
  const attachmentRepository = new SqliteAttachmentRepository(db);
  const preferencesRepository = new SqlitePreferencesRepository(db);

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
  const rateLimiter = new RateLimiter(rateLimit);
  const transactions = new SqliteTransactionManager(db);
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
  const groupService = new GroupService(
    roomRepository,
    roomMemberRepository,
    userRepository,
    preferencesRepository,
  );
  const notificationService = new NotificationService(
    new SqliteNotificationRepository(db),
    userRepository,
  );
  const messageMutationRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const groupCreateRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });

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
    new EditMessageHandler(
      messageService,
      roomRepository,
      roomMemberRepository,
      messageMutationRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(
    new DeleteMessageHandler(
      messageService,
      roomRepository,
      roomMemberRepository,
      messageMutationRateLimiter,
      connectionManager,
      codec,
    ),
  );
  wsRegistry.register(new MessageHistoryHandler(messageService));
  wsRegistry.register(new MarkReadHandler(roomReadService, connectionManager, codec));
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
    createChannel,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

/**
 * `message.new`/`message.updated` broadcast to every audience member *including the
 * sender* (docs/03-websocket-events.md says "sent to all members ... currently
 * connected", with no carve-out for the sender — matching the already-established
 * self-inclusive `presence.updated` broadcast from Phase 3). Since the push is sent
 * from inside the handler and the RPC ack is sent afterward by connection.ts, the
 * sender's own socket always sees [self-echo push, ack] in that order. This helper
 * drains the self-echo and returns the ack.
 */
async function sendAndGetAck(queue: WsMessageQueue, echoEvent: string): Promise<WsResponse> {
  const echo = await queue.next() as WsPush;
  if (echo.event !== echoEvent) {
    throw new Error(`expected to drain a self-echo "${echoEvent}", got "${echo.event}"`);
  }
  return await queue.next() as WsResponse;
}

Deno.test("WS message.send: two clients in the same channel, one sends, the other receives message.new", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("smoke-channel-1");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain the "bob came online" presence push

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "hello bob",
    });

    const [ackResponse, bobPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.new"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];

    assertEquals(ackResponse.success, true);
    const sentMessage = ackResponse.data!.message as { id: string; content: string };
    assertEquals(sentMessage.content, "hello bob");

    assertEquals(bobPush.event, "message.new");
    assertEquals((bobPush.data.message as { content: string }).content, "hello bob");
    assertEquals((bobPush.data.message as { id: string }).id, sentMessage.id);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS message.send in a group only reaches members, and pushes unread.updated to the other member", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const owner = await registerUser("owner");
    const member = await registerUser("member");
    const member2 = await registerUser("member2");
    const outsider = await registerUser("outsider");

    const ownerConn = await connectAsSoleUser(owner.accessToken);
    send(ownerConn.socket, "1", "group.create", {
      name: "G",
      memberIds: [member.userId, member2.userId], // 3 total: min group size
    });
    await ownerConn.queue.next(); // drain the group.create system message.new self-echo
    await ownerConn.queue.next(); // drain the group.create room.updated self-echo
    const createResponse = await ownerConn.queue.next() as WsResponse;
    const room = createResponse.data!.room as { id: string };

    const memberConn = await connectAsSoleUser(member.accessToken);
    await ownerConn.queue.next(); // drain the "member came online" presence push

    const outsiderConn = await connectAsSoleUser(outsider.accessToken);
    await ownerConn.queue.next(); // drain the "outsider came online" presence push
    await memberConn.queue.next(); // ditto, observed by member too

    send(ownerConn.socket, "2", "message.send", {
      conversationId: room.id,
      content: "group hello",
    });
    const [ackResponse, memberPush] = await Promise.all([
      sendAndGetAck(ownerConn.queue, "message.new"),
      memberConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(ackResponse.success, true);
    assertEquals(memberPush.event, "message.new");

    // The outsider is not a member, so they should get nothing within a short window.
    // WsMessageQueue.next(timeoutMs) rejects on timeout, so that rejection *is* the
    // "nothing arrived" signal here, not a real test failure.
    const outsiderResult = await outsiderConn.queue.next(200).then(() => "message").catch(() =>
      "timeout"
    );
    assertEquals(outsiderResult, "timeout");

    ownerConn.socket.close();
    memberConn.socket.close();
    outsiderConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS message.edit/message.delete: author-only, broadcasts message.updated", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("smoke-channel-2");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain the "bob came online" presence push

    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "original",
    });
    const [sendAck] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.new"),
      bobConn.queue.next(), // message.new
    ]) as [WsResponse, WsPush];
    await bobConn.queue.next(); // drain the unread.updated the send also pushes to bob
    const messageId = (sendAck.data!.message as { id: string }).id;

    send(aliceConn.socket, "2", "message.edit", { messageId, content: "edited" });
    const [editAck, bobEditPush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(editAck.success, true);
    assertEquals((editAck.data!.message as { content: string }).content, "edited");
    assertEquals(bobEditPush.event, "message.updated");
    assertEquals((bobEditPush.data.message as { edited: boolean }).edited, true);

    // Try deleting without confirm flag (should fail validation)
    send(aliceConn.socket, "3-fail", "message.delete", { messageId });
    const failAck = await aliceConn.queue.next() as WsResponse;
    assertEquals(failAck.success, false);
    assertEquals(failAck.error?.code, "VALIDATION_ERROR");

    // Delete with confirm: true
    send(aliceConn.socket, "3", "message.delete", { messageId, confirm: true });
    const [deleteAck, bobDeletePush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.updated"),
      bobConn.queue.next(),
    ]) as [WsResponse, WsPush];
    assertEquals(deleteAck.success, true);
    assertEquals(bobDeletePush.event, "message.updated");
    assert((bobDeletePush.data.message as { deletedAt: string | null }).deletedAt !== null);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS message.history returns messages ending just before the given cursor", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("smoke-channel-3");
    const alice = await registerUser("alice");
    const aliceConn = await connectAsSoleUser(alice.accessToken);

    for (let i = 0; i < 3; i++) {
      send(aliceConn.socket, `send-${i}`, "message.send", {
        conversationId: channel.id,
        content: `m${i}`,
      });
      await sendAndGetAck(aliceConn.queue, "message.new");
    }

    send(aliceConn.socket, "hist", "message.history", { conversationId: channel.id, limit: 2 });
    const historyResponse = await aliceConn.queue.next() as WsResponse;
    assertEquals(historyResponse.success, true);
    const contents = (historyResponse.data!.messages as Array<{ content: string }>).map((m) =>
      m.content
    );
    assertEquals(contents, ["m1", "m2"]);
    assertEquals(historyResponse.data!.hasMore, true);

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS room.markRead clears the unread counter and pushes unread.updated to the caller", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer();
  try {
    const channel = createChannel("smoke-channel-4");
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    const bobConn = await connectAsSoleUser(bob.accessToken);
    await aliceConn.queue.next(); // drain the "bob came online" presence push

    send(aliceConn.socket, "1", "message.send", { conversationId: channel.id, content: "hi bob" });
    const [sendAck, bobMessagePush] = await Promise.all([
      sendAndGetAck(aliceConn.queue, "message.new"),
      bobConn.queue.next(), // message.new
    ]) as [WsResponse, WsPush];
    const messageId = (sendAck.data!.message as { id: string }).id;
    assertEquals((bobMessagePush.data.message as { id: string }).id, messageId);

    const bobUnreadUpdate = await bobConn.queue.next() as WsPush; // unread.updated from the send
    assertEquals(bobUnreadUpdate.event, "unread.updated");
    assertEquals(bobUnreadUpdate.data.count, 1);

    send(bobConn.socket, "2", "room.markRead", { conversationId: channel.id, messageId });
    // MarkReadHandler pushes unread.updated *inside* handle(), before the ack response
    // is sent by connection.ts once handle() returns — so on the same socket, the push
    // always arrives before the ack.
    const [bobUnreadAfterRead, markReadAck] = await Promise.all([
      bobConn.queue.next(),
      bobConn.queue.next(),
    ]) as [WsPush, WsResponse];
    assertEquals(bobUnreadAfterRead.event, "unread.updated");
    assertEquals(bobUnreadAfterRead.data.count, 0);
    assertEquals(markReadAck.success, true);

    aliceConn.socket.close();
    bobConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS message.send is rate-limited: RATE_LIMITED after exceeding the bucket", async () => {
  const { registerUser, connectAsSoleUser, createChannel, cleanup } = await bootTestServer({
    maxTokens: 2,
    refillIntervalMs: 10_000,
  });
  try {
    const channel = createChannel("smoke-channel-5");
    const alice = await registerUser("alice");
    const aliceConn = await connectAsSoleUser(alice.accessToken);

    send(aliceConn.socket, "1", "message.send", { conversationId: channel.id, content: "1" });
    assertEquals((await sendAndGetAck(aliceConn.queue, "message.new")).success, true);
    send(aliceConn.socket, "2", "message.send", { conversationId: channel.id, content: "2" });
    assertEquals((await sendAndGetAck(aliceConn.queue, "message.new")).success, true);
    send(aliceConn.socket, "3", "message.send", { conversationId: channel.id, content: "3" });
    const limited = await aliceConn.queue.next() as WsResponse;
    assertEquals(limited.success, false);
    assertEquals(limited.error!.code, "RATE_LIMITED");

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});
