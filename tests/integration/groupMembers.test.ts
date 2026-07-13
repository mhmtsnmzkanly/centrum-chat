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
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { OpenDmHandler } from "../../src/application/websocket/handlers/dm/openDmHandler.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
import { GroupMembersHandler } from "../../src/application/websocket/handlers/groups/groupMembersHandler.ts";
import { createPresenceAwareConnectionManager } from "../support/testConnectionManager.ts";

async function bootTestServer() {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-group-members");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });

  const userRepository = new SqliteUserRepository(db);
  const roomRepository = new SqliteConversationRepository(db);
  const roomMemberRepository = new SqliteConversationMembershipRepository(db);
  const directConversationPairRepository = new SqliteDirectConversationPairRepository(db);
  const preferencesRepository = new SqlitePreferencesRepository(db);
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
  const presenceService = new PresenceService(userRepository);
  const connectionManager = createPresenceAwareConnectionManager(presenceService, codec);
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
  const notificationService = new NotificationService(
    new SqliteNotificationRepository(db),
    userRepository,
  );

  const groupCreateRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });
  const dmOpenRateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });

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
  wsRegistry.register(new OpenDmHandler(dmService, dmOpenRateLimiter));
  wsRegistry.register(new GroupMembersHandler(groupService));

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
      username: `${label}_${suffix}`,
      accessToken: result.accessToken,
    };
  }

  async function connectUser(
    accessToken: string,
  ): Promise<{ socket: WebSocket; queue: WsMessageQueue }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${accessToken}`);
    const queue = new WsMessageQueue(socket);
    await waitForOpen(socket);
    // drain own presence push
    await queue.next();
    return { socket, queue };
  }

  return {
    registerUser,
    connectUser,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

interface WsPush {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

interface WsResponse {
  readonly id: string;
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { code: string };
}

Deno.test("WS group.members returns participants for groups and DMs", async () => {
  const { registerUser, connectUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const charlie = await registerUser("charlie");

    const { socket: aSocket, queue: aQueue } = await connectUser(alice.accessToken);

    // 1. Create a group with Alice, Bob, and Charlie
    send(aSocket, "1", "group.create", {
      name: "Alpha Group",
      memberIds: [bob.userId, charlie.userId],
    });
    // group.create broadcasts a system message.new and room.updated to the member(s) before the RPC ack
    await aQueue.next(); // system message
    await aQueue.next(); // room.updated

    const createRes = await aQueue.next() as WsResponse;
    assertEquals(createRes.success, true);
    const groupId = (createRes.data! as Record<string, { id: string }>).room!.id;

    // 2. Retrieve members of the group
    send(aSocket, "2", "group.members", { groupId });
    const membersRes = await aQueue.next() as WsResponse;
    assertEquals(membersRes.success, true);
    const members = (membersRes.data! as { members: Array<{ id: string }> }).members;
    const memberIds = members.map((m) => m.id).sort();
    const expectedIds = [alice.userId, bob.userId, charlie.userId].sort();
    assertEquals(memberIds, expectedIds);

    // 3. Open a DM between Alice and Bob
    send(aSocket, "3", "dm.open", { userId: bob.userId });
    const dmRes = await aQueue.next() as WsResponse;
    assertEquals(dmRes.success, true);
    const dmRoomId = (dmRes.data! as Record<string, { id: string }>).room!.id;

    // 4. Retrieve members of the DM room (should return Alice and Bob)
    send(aSocket, "4", "group.members", { groupId: dmRoomId });
    const dmMembersRes = await aQueue.next() as WsResponse;
    assertEquals(dmMembersRes.success, true);
    const dmMembers = (dmMembersRes.data! as { members: Array<{ id: string }> }).members;
    const dmMemberIds = dmMembers.map((m) => m.id).sort();
    const expectedDmIds = [alice.userId, bob.userId].sort();
    assertEquals(dmMemberIds, expectedDmIds);

    aSocket.close();
  } finally {
    await cleanup();
  }
});
