import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import type { ConnectionManagerOptions } from "../../src/transport/websocket/connectionManager.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { waitForOpen, waitForOpenOrError, WsMessageQueue } from "../support/wsTestClient.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { createPresenceAwareConnectionManager } from "../support/testConnectionManager.ts";
import { SystemPongHandler } from "../../src/application/websocket/handlers/system/systemPongHandler.ts";
import { WebSocketLifecycleJob } from "../../src/application/lifecycle/webSocketLifecycleJob.ts";

async function bootTestServer(
  options: {
    protocolErrorLimit?: number;
    maxMessageBytes?: number;
    inboundRateLimiter?: RateLimiter;
    connectionManagerOptions?: ConnectionManagerOptions;
    heartbeatIntervalMs?: number;
    idleTimeoutMs?: number;
  } = {},
) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-ws");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  const userRepository = new SqliteUserRepository(db);
  const authService = new AuthService(
    userRepository,
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );
  const presenceService = new PresenceService(userRepository);
  const connectionManager = createPresenceAwareConnectionManager(
    presenceService,
    codec,
    options.connectionManagerOptions,
  );
  wsRegistry.register(new SystemPongHandler());

  const lifecycleJob =
    options.heartbeatIntervalMs === undefined || options.idleTimeoutMs === undefined
      ? null
      : new WebSocketLifecycleJob(
        connectionManager,
        codec,
        logger,
        {
          heartbeatIntervalMs: options.heartbeatIntervalMs,
          idleTimeoutMs: options.idleTimeoutMs,
        },
      );
  lifecycleJob?.start();

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
        ...(options.protocolErrorLimit === undefined
          ? {}
          : { protocolErrorLimit: options.protocolErrorLimit }),
        ...(options.maxMessageBytes === undefined
          ? {}
          : { maxMessageBytes: options.maxMessageBytes }),
        ...(options.inboundRateLimiter === undefined
          ? {}
          : { inboundRateLimiter: options.inboundRateLimiter }),
      }),
  });
  const port = (server.addr as Deno.NetAddr).port;

  async function issueSession(): Promise<{ userId: string; accessToken: string }> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const result = await authService.register({
      username: `user_${suffix}`,
      email: `user_${suffix}@example.com`,
      password: "correct-horse-battery",
      displayName: "Test User",
    });
    return { userId: result.profile.id, accessToken: result.accessToken };
  }

  async function issueAccessToken(): Promise<string> {
    return (await issueSession()).accessToken;
  }

  /** Connects, attaches a message queue from before "open" resolves (no drop window),
   * and drains the connection's own "I just came online" presence.updated push. */
  async function connectAsSoleUser(): Promise<{ socket: WebSocket; queue: WsMessageQueue }> {
    const token = await issueAccessToken();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const queue = new WsMessageQueue(socket);
    await waitForOpen(socket);
    await queue.next(); // drain this connection's own presence.updated (online) push
    return { socket, queue };
  }

  return {
    connectionManager,
    port,
    issueSession,
    issueAccessToken,
    connectAsSoleUser,
    cleanup: async () => {
      lifecycleJob?.stop();
      await server.shutdown();
      // Socket "close" listeners (connection.ts) run presence disconnect logic
      // synchronously but are themselves dispatched asynchronously relative to
      // server.shutdown() resolving; give them a tick before the DB closes under them.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

Deno.test("WS: connecting with a valid token registers the connection with the ConnectionManager", async () => {
  const { connectionManager, port, issueAccessToken, cleanup } = await bootTestServer();
  const token = await issueAccessToken();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  await waitForOpen(socket);

  // give the server-side "open" listener a tick to run before asserting
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(connectionManager.count(), 1);

  socket.close();
  await cleanup();
});

Deno.test("WS: malformed JSON gets a protocol.error push, not a crash", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer();
  const { socket, queue } = await connectAsSoleUser();

  socket.send("{not valid json");
  const message = await queue.next() as { event: string; data: { code: string } };

  assertEquals(message.event, "protocol.error");
  assertEquals(message.data.code, "VALIDATION_ERROR");

  socket.close();
  await cleanup();
});

Deno.test("WS: well-formed envelope with an unregistered event returns NOT_FOUND, correlated by id", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer();
  const { socket, queue } = await connectAsSoleUser();

  socket.send(JSON.stringify({ id: "c-42", event: "does.not.exist", data: {} }));
  const message = await queue.next() as {
    id: string;
    event: string;
    success: boolean;
    error: { code: string };
  };

  assertEquals(message.id, "c-42");
  assertEquals(message.event, "does.not.exist");
  assertEquals(message.success, false);
  assertEquals(message.error.code, "NOT_FOUND");

  socket.close();
  await cleanup();
});

Deno.test("WS: envelope missing required fields gets a protocol.error push", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer();
  const { socket, queue } = await connectAsSoleUser();

  socket.send(JSON.stringify({ event: "message.send" })); // missing id and data
  const message = await queue.next() as { event: string; data: { code: string } };

  assertEquals(message.event, "protocol.error");
  assertEquals(message.data.code, "VALIDATION_ERROR");

  socket.close();
  await cleanup();
});

Deno.test("WS: upgrade is rejected (never opens) when the token is missing", async () => {
  const { port, cleanup } = await bootTestServer();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);

  const outcome = await waitForOpenOrError(socket);
  assertEquals(outcome, "error");

  await cleanup();
});

Deno.test("WS: upgrade is rejected (never opens) when the token is invalid", async () => {
  const { port, cleanup } = await bootTestServer();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=not-a-real-token`);

  const outcome = await waitForOpenOrError(socket);
  assertEquals(outcome, "error");

  await cleanup();
});

Deno.test("WS: repeated malformed payloads close the socket after the protocol error limit", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer({ protocolErrorLimit: 2 });
  const { socket, queue } = await connectAsSoleUser();

  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });

  socket.send("{bad");
  assertEquals((await queue.next() as { event: string }).event, "protocol.error");
  socket.send("{still bad");
  assertEquals((await queue.next() as { event: string }).event, "protocol.error");

  assertEquals(await closed, 1008);
  await cleanup();
});

Deno.test("WS: oversized payloads are rejected and closed with message-too-big", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer({
    protocolErrorLimit: 1,
    maxMessageBytes: 32,
  });
  const { socket, queue } = await connectAsSoleUser();
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });

  socket.send(JSON.stringify({ id: "x", event: "noop", data: "x".repeat(200) }));
  assertEquals((await queue.next() as { event: string }).event, "protocol.error");
  assertEquals(await closed, 1009);

  await cleanup();
});

Deno.test("WS: transport-level inbound rate limiting returns RATE_LIMITED before dispatch", async () => {
  const { connectAsSoleUser, cleanup } = await bootTestServer({
    inboundRateLimiter: new RateLimiter({ maxTokens: 1, refillIntervalMs: 60_000 }),
  });
  const { socket, queue } = await connectAsSoleUser();

  socket.send(JSON.stringify({ id: "one", event: "does.not.exist", data: {} }));
  const first = await queue.next() as { id: string; success: boolean; error: { code: string } };
  assertEquals(first.id, "one");
  assertEquals(first.error.code, "NOT_FOUND");

  socket.send(JSON.stringify({ id: "two", event: "does.not.exist", data: {} }));
  const second = await queue.next() as { id: string; success: boolean; error: { code: string } };
  assertEquals(second.id, "two");
  assertEquals(second.success, false);
  assertEquals(second.error.code, "RATE_LIMITED");

  socket.close();
  await cleanup();
});

Deno.test("WS: per-user connection cap rejects the next socket and allows reconnect after cleanup", async () => {
  const { port, issueSession, connectionManager, cleanup } = await bootTestServer({
    connectionManagerOptions: { maxConnectionsPerUser: 1, maxConnectionsPerIp: 10 },
  });
  const session = await issueSession();

  const first = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${session.accessToken}`);
  await waitForOpen(first);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(connectionManager.countConnectionsForUser(session.userId), 1);

  const second = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${session.accessToken}`);
  assertEquals(await waitForOpenOrError(second), "error");
  assertEquals(connectionManager.countConnectionsForUser(session.userId), 1);

  first.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(connectionManager.countConnectionsForUser(session.userId), 0);

  const third = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${session.accessToken}`);
  await waitForOpen(third);
  third.close();
  await cleanup();
});

Deno.test("WS: per-IP connection cap rejects the next authenticated user on the same peer IP", async () => {
  const { port, issueSession, connectionManager, cleanup } = await bootTestServer({
    connectionManagerOptions: { maxConnectionsPerUser: 5, maxConnectionsPerIp: 2 },
  });
  const firstSession = await issueSession();
  const secondSession = await issueSession();
  const thirdSession = await issueSession();

  const first = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${firstSession.accessToken}`);
  const second = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${secondSession.accessToken}`);
  await waitForOpen(first);
  await waitForOpen(second);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(connectionManager.count(), 2);

  const third = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${thirdSession.accessToken}`);
  assertEquals(await waitForOpenOrError(third), "error");
  assertEquals(connectionManager.count(), 2);

  first.close();
  second.close();
  await cleanup();
});

Deno.test("WS: slow-client backpressure closes only the slow socket and fanout still reaches a healthy client", async () => {
  let slowServerSocket: WebSocket | null = null;
  const socketOps = {
    getReadyState: (socket: WebSocket) => socket.readyState,
    getBufferedAmount: (socket: WebSocket) => (socket === slowServerSocket ? 2 : 0),
    send: (socket: WebSocket, data: string | Uint8Array) => socket.send(data),
    close: (socket: WebSocket, code: number, reason: string) => socket.close(code, reason),
  };
  const { port, issueSession, connectionManager, cleanup } = await bootTestServer({
    connectionManagerOptions: {
      maxBufferedAmountBytes: 1,
      socketOps,
    },
  });
  const slowSession = await issueSession();
  const healthySession = await issueSession();
  const triggerSession = await issueSession();

  const slowSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${slowSession.accessToken}`);
  const slowQueue = new WsMessageQueue(slowSocket);
  await waitForOpen(slowSocket);
  await slowQueue.next();

  const healthySocket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?token=${healthySession.accessToken}`,
  );
  const healthyQueue = new WsMessageQueue(healthySocket);
  await waitForOpen(healthySocket);
  await slowQueue.next(); // presence.updated for the healthy user
  await healthyQueue.next(); // healthy user's own presence.updated

  slowServerSocket =
    connectionManager.listOpenConnections().find((connection) =>
      connection.userId === slowSession.userId
    )
      ?.socket ?? null;

  const slowClosed = new Promise<number>((resolve) => {
    slowSocket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });

  const triggerSocket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?token=${triggerSession.accessToken}`,
  );
  const triggerQueue = new WsMessageQueue(triggerSocket);
  await waitForOpen(triggerSocket);

  const healthyPush = await healthyQueue.next() as { event: string };
  assertEquals(healthyPush.event, "presence.updated");
  assertEquals(await slowClosed, 1008);

  await triggerQueue.next(); // trigger user's own presence.updated
  triggerSocket.close();
  healthySocket.close();
  await cleanup();
});

Deno.test("WS: lifecycle heartbeat keeps an active client alive and closes a stale one", async () => {
  const { port, issueSession, connectionManager, cleanup } = await bootTestServer({
    heartbeatIntervalMs: 30,
    idleTimeoutMs: 90,
  });
  const staleSession = await issueSession();
  const healthySession = await issueSession();

  const staleSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${staleSession.accessToken}`);
  const staleQueue = new WsMessageQueue(staleSocket);
  await waitForOpen(staleSocket);
  await staleQueue.next();

  const healthySocket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?token=${healthySession.accessToken}`,
  );
  const healthyQueue = new WsMessageQueue(healthySocket);
  let pongId = 0;
  healthySocket.addEventListener("message", (event) => {
    const parsed = JSON.parse(event.data as string);
    if (parsed.event === "system.ping") {
      healthySocket.send(
        JSON.stringify({ id: `pong-${++pongId}`, event: "system.pong", data: {} }),
      );
    }
  });
  await waitForOpen(healthySocket);
  await staleQueue.next(); // presence.updated for the healthy user
  await healthyQueue.next(); // healthy user's own presence.updated

  const staleClosed = new Promise<number>((resolve) => {
    staleSocket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });

  await new Promise((resolve) => setTimeout(resolve, 220));

  assertEquals(await staleClosed, 1001);
  assertEquals(connectionManager.countConnectionsForUser(staleSession.userId), 0);
  assertEquals(connectionManager.countConnectionsForUser(healthySession.userId), 1);

  healthySocket.close();
  await cleanup();
});
