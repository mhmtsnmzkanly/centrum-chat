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
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { UserService } from "../../src/domain/users/userService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { AttachmentService } from "../../src/domain/attachments/attachmentService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { SendMessageHandler } from "../../src/application/websocket/handlers/messages/sendMessageHandler.ts";
import { UploadRoute } from "../../src/application/http/routes/media/uploadRoute.ts";
import { AvatarRoute } from "../../src/application/http/routes/media/avatarRoute.ts";
import { ServeMediaRoute } from "../../src/application/http/routes/media/serveMediaRoute.ts";
import { CoverRoute } from "../../src/application/http/routes/media/coverRoute.ts";
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

/** `message.new` broadcasts to the whole room audience, including the sender's own
 * socket (a channel room's audience is everyone connected — see
 * tests/integration/messages.test.ts for the fuller explanation). The push arrives
 * before the RPC ack, so this drains it first. */
async function sendAndGetAck(queue: WsMessageQueue, echoEvent: string): Promise<WsResponse> {
  const echo = await queue.next() as WsPush;
  if (echo.event !== echoEvent) {
    throw new Error(`expected to drain a self-echo "${echoEvent}", got "${echo.event}"`);
  }
  return await queue.next() as WsResponse;
}

async function bootTestServer(
  options: { maxAttachmentSizeBytes?: number; maxAvatarSizeBytes?: number } = {},
) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const mediaRoot = await Deno.makeTempDir({ prefix: "centrumchat-media-test-" });
  const logger = createLogger("error", "test-media");
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
  const transactions = new SqliteTransactionManager(db);

  const authService = new AuthService(
    userRepository,
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );
  const userService = new UserService(userRepository);
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
  const attachmentService = new AttachmentService(attachmentRepository);
  const notificationService = new NotificationService(
    new SqliteNotificationRepository(db),
    userRepository,
  );

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

  registry.register(
    new UploadRoute(
      tokenService,
      attachmentService,
      mediaRoot,
      options.maxAttachmentSizeBytes ?? 26_214_400,
      codec,
    ),
  );
  registry.register(
    new AvatarRoute(
      tokenService,
      attachmentService,
      userService,
      mediaRoot,
      options.maxAvatarSizeBytes ?? 5_242_880,
      codec,
    ),
  );
  registry.register(
    new CoverRoute(
      tokenService,
      attachmentService,
      userService,
      mediaRoot,
      options.maxAvatarSizeBytes ?? 5_242_880,
      codec,
    ),
  );
  registry.register(
    new ServeMediaRoute(
      attachmentService,
      messageRepository,
      roomRepository,
      permissionService,
      tokenService,
      mediaRoot,
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
  const baseUrl = `http://127.0.0.1:${port}`;

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
    baseUrl,
    registerUser,
    createChannel,
    connectAsSoleUser,
    attachmentService,
    cleanup: async () => {
      await server.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
      await Deno.remove(mediaRoot, { recursive: true });
    },
  };
}

function makeUploadForm(fileName: string, mimeType: string, bytes: Uint8Array): FormData {
  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], fileName, { type: mimeType }));
  return form;
}

function makePngBytes(label: string): Uint8Array {
  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const tail = new TextEncoder().encode(label);
  const bytes = new Uint8Array(header.length + tail.length);
  bytes.set(header, 0);
  bytes.set(tail, header.length);
  return bytes;
}

Deno.test("Media flow: upload -> attach via message.send -> fetch back via GET /media/:id", async () => {
  const { baseUrl, registerUser, createChannel, connectAsSoleUser, cleanup } =
    await bootTestServer();
  try {
    const channel = createChannel("media-1");
    const alice = await registerUser("alice");
    const bytes = new TextEncoder().encode("hello attachment bytes");

    const uploadResponse = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("note.txt", "text/plain", bytes),
    });
    assertEquals(uploadResponse.status, 201);
    const uploadBody = await uploadResponse.json();
    assertEquals(uploadBody.success, true);
    const { attachmentId, url } = uploadBody.data;
    assertEquals(uploadBody.data.fileName, "note.txt");
    assertEquals(uploadBody.data.mimeType, "text/plain");
    assertEquals(uploadBody.data.sizeBytes, bytes.length);
    assertEquals(url, `/media/${attachmentId}`);

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "see attached",
      attachmentId,
    });
    const ack = await sendAndGetAck(aliceConn.queue, "message.new");
    assertEquals(ack.success, true);
    const message = ack.data!.message as { attachments: unknown };
    assertEquals(message.attachments, [
      {
        id: attachmentId,
        fileName: "note.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        url,
      },
    ]);

    const fetchResponse = await fetch(`${baseUrl}${url}`, {
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assertEquals(fetchResponse.status, 200);
    assertEquals(fetchResponse.headers.get("content-type"), "text/plain");
    const fetchedBytes = new Uint8Array(await fetchResponse.arrayBuffer());
    assertEquals(fetchedBytes, bytes);

    aliceConn.socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("GET /media/:id denies fetching a room-attached attachment without auth, and 404s for an unknown id", async () => {
  const { baseUrl, registerUser, createChannel, connectAsSoleUser, cleanup } =
    await bootTestServer();
  try {
    const channel = createChannel("media-2");
    const alice = await registerUser("alice");
    const bytes = new TextEncoder().encode("secret-ish bytes");

    const uploadResponse = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("data.bin", "application/octet-stream", bytes),
    });
    const { attachmentId, url } = (await uploadResponse.json()).data;

    const aliceConn = await connectAsSoleUser(alice.accessToken);
    send(aliceConn.socket, "1", "message.send", {
      conversationId: channel.id,
      content: "x",
      attachmentId,
    });
    await sendAndGetAck(aliceConn.queue, "message.new");
    aliceConn.socket.close();

    const unauthedResponse = await fetch(`${baseUrl}${url}`);
    assertEquals(unauthedResponse.status, 401);
    await unauthedResponse.body?.cancel();

    // `?token=` query-param fallback (docs/04-http-api.md "GET /media/:id") — the
    // path an `<img>` tag uses, since it cannot send an Authorization header.
    const queryTokenResponse = await fetch(
      `${baseUrl}${url}?token=${encodeURIComponent(alice.accessToken)}`,
    );
    assertEquals(queryTokenResponse.status, 200);
    await queryTokenResponse.body?.cancel();

    const badQueryTokenResponse = await fetch(`${baseUrl}${url}?token=not-a-real-token`);
    assertEquals(badQueryTokenResponse.status, 401);
    await badQueryTokenResponse.body?.cancel();

    const missingResponse = await fetch(`${baseUrl}/media/00000000-0000-4000-8000-000000000000`);
    assertEquals(missingResponse.status, 404);
    await missingResponse.body?.cancel();
  } finally {
    await cleanup();
  }
});

Deno.test("GET /media/:id only allows the uploader to fetch an unattached attachment", async () => {
  const { baseUrl, registerUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");
    const bytes = new TextEncoder().encode("owner-only attachment");

    const uploadResponse = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("../sneaky.txt", "text/plain", bytes),
    });
    assertEquals(uploadResponse.status, 201);
    const { attachmentId, fileName } = (await uploadResponse.json()).data;
    assertEquals(fileName, "sneaky.txt");

    const ownerFetch = await fetch(`${baseUrl}/media/${attachmentId}`, {
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assertEquals(ownerFetch.status, 200);
    assertEquals(
      ownerFetch.headers.get("content-disposition"),
      'attachment; filename="sneaky.txt"',
    );
    await ownerFetch.body?.cancel();

    const otherFetch = await fetch(`${baseUrl}/media/${attachmentId}`, {
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assertEquals(otherFetch.status, 403);
    await otherFetch.body?.cancel();
  } finally {
    await cleanup();
  }
});

Deno.test("Media flow: avatar upload updates avatarUrl, is served unauthenticated, and replaces the old file", async () => {
  const { baseUrl, registerUser, attachmentService, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const firstAvatar = makePngBytes("first-avatar-bytes");

    const firstResponse = await fetch(`${baseUrl}/api/media/avatar`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("avatar1.png", "image/png", firstAvatar),
    });
    assertEquals(firstResponse.status, 200);
    const { avatarUrl: firstAvatarUrl } = (await firstResponse.json()).data;

    const unauthedFetch = await fetch(`${baseUrl}${firstAvatarUrl}`);
    assertEquals(unauthedFetch.status, 200);
    assertEquals(unauthedFetch.headers.get("content-type"), "image/png");
    assertEquals(new Uint8Array(await unauthedFetch.arrayBuffer()), firstAvatar);

    const firstAttachmentId = firstAvatarUrl.split("/").pop();
    assert(attachmentService.findById(firstAttachmentId) !== null);

    const secondAvatar = makePngBytes("second-avatar-bytes");
    const secondResponse = await fetch(`${baseUrl}/api/media/avatar`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("avatar2.png", "image/png", secondAvatar),
    });
    const { avatarUrl: secondAvatarUrl } = (await secondResponse.json()).data;
    assert(secondAvatarUrl !== firstAvatarUrl);

    // The old avatar's row and file are both gone once the new one is persisted.
    assertEquals(attachmentService.findById(firstAttachmentId), null);
    const oldFetch = await fetch(`${baseUrl}${firstAvatarUrl}`);
    assertEquals(oldFetch.status, 404);
    await oldFetch.body?.cancel();

    const newFetch = await fetch(`${baseUrl}${secondAvatarUrl}`);
    assertEquals(new Uint8Array(await newFetch.arrayBuffer()), secondAvatar);
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/media/avatar rejects a non-image file", async () => {
  const { baseUrl, registerUser, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const response = await fetch(`${baseUrl}/api/media/avatar`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("not-an-image.txt", "text/plain", new TextEncoder().encode("hi")),
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/media/upload rejects a file over the configured size limit", async () => {
  const { baseUrl, registerUser, cleanup } = await bootTestServer({ maxAttachmentSizeBytes: 10 });
  try {
    const alice = await registerUser("alice");
    const response = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("big.bin", "application/octet-stream", new Uint8Array(100)),
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    await cleanup();
  }
});

Deno.test("Media flow: cover upload updates coverUrl, is served unauthenticated, and replaces the old file", async () => {
  const { baseUrl, registerUser, attachmentService, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const firstCover = makePngBytes("first-cover-bytes");

    const firstResponse = await fetch(`${baseUrl}/api/media/cover`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("cover1.png", "image/png", firstCover),
    });
    assertEquals(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assertEquals(firstBody.success, true);
    const coverUrl = firstBody.data.coverUrl;
    assert(coverUrl.startsWith("/media/"));

    // Fetch cover back unauthenticated
    const fetchResponse = await fetch(`${baseUrl}${coverUrl}`);
    assertEquals(fetchResponse.status, 200);
    assertEquals(fetchResponse.headers.get("content-type"), "image/png");
    const fetchedBytes = new Uint8Array(await fetchResponse.arrayBuffer());
    assertEquals(fetchedBytes, firstCover);

    // Upload second cover to verify cleanup of the old cover file
    const secondCover = makePngBytes("second-cover-bytes-much-longer");
    const secondResponse = await fetch(`${baseUrl}/api/media/cover`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      body: makeUploadForm("cover2.png", "image/png", secondCover),
    });
    assertEquals(secondResponse.status, 200);
    const secondBody = await secondResponse.json();
    assertEquals(secondBody.success, true);
    const secondCoverUrl = secondBody.data.coverUrl;

    // Verify first cover is gone (deleted from disk/DB)
    const oldAttachmentId = coverUrl.slice("/media/".length);
    const oldRecord = await attachmentService.findById(oldAttachmentId);
    assertEquals(oldRecord, null);

    const oldFileResponse = await fetch(`${baseUrl}${coverUrl}`);
    assertEquals(oldFileResponse.status, 404);
    await oldFileResponse.body?.cancel();

    // Verify second cover works
    const newFileResponse = await fetch(`${baseUrl}${secondCoverUrl}`);
    assertEquals(newFileResponse.status, 200);
    const newBytes = new Uint8Array(await newFileResponse.arrayBuffer());
    assertEquals(newBytes, secondCover);
  } finally {
    await cleanup();
  }
});
