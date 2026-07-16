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
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { UserService } from "../../src/domain/users/userService.ts";
import { PresenceService } from "../../src/domain/presence/presenceService.ts";
import { PreferencesService } from "../../src/domain/preferences/preferencesService.ts";
import { UpdatePresenceHandler } from "../../src/application/websocket/handlers/presence/updatePresenceHandler.ts";
import { GetProfileHandler } from "../../src/application/websocket/handlers/profile/getProfileHandler.ts";
import { UpdateProfileHandler } from "../../src/application/websocket/handlers/profile/updateProfileHandler.ts";
import { GetPreferencesHandler } from "../../src/application/websocket/handlers/profile/getPreferencesHandler.ts";
import { UpdatePreferencesHandler } from "../../src/application/websocket/handlers/profile/updatePreferencesHandler.ts";
import { createPresenceAwareConnectionManager } from "../support/testConnectionManager.ts";

async function bootTestServer() {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-profile-presence");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const wsRegistry = new WebSocketHandlerRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });

  const userRepository = new SqliteUserRepository(db);
  const preferencesRepository = new SqlitePreferencesRepository(db);
  const authService = new AuthService(
    userRepository,
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );
  const userService = new UserService(userRepository);
  const presenceService = new PresenceService(userRepository);
  const preferencesService = new PreferencesService(preferencesRepository);
  const connectionManager = createPresenceAwareConnectionManager(presenceService, codec);

  wsRegistry.register(new UpdatePresenceHandler(presenceService, connectionManager, codec));
  wsRegistry.register(new GetProfileHandler(userService));
  wsRegistry.register(new UpdateProfileHandler(userService));
  wsRegistry.register(new GetPreferencesHandler(preferencesService));
  wsRegistry.register(new UpdatePreferencesHandler(preferencesService));

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
   * and drains the connection's own "I just came online" presence.updated push
   * (connectionManager.broadcastToAll fans out to the connection that triggered it too). */
  async function connectAsSoleUser(
    accessToken: string,
  ): Promise<{ socket: WebSocket; queue: WsMessageQueue }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${accessToken}`);
    const queue = new WsMessageQueue(socket);
    await waitForOpen(socket);
    const ownOnlinePush = await queue.next() as { event: string };
    if (ownOnlinePush.event !== "presence.updated") {
      throw new Error(`expected to drain a presence.updated push, got ${ownOnlinePush.event}`);
    }
    return { socket, queue };
  }

  function connectWithQueue(accessToken: string): { socket: WebSocket; queue: WsMessageQueue } {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${accessToken}`);
    const queue = new WsMessageQueue(socket);
    return { socket, queue };
  }

  return {
    registerUser,
    connectAsSoleUser,
    connectWithQueue,
    cleanup: async () => {
      await server.shutdown();
      // Socket "close" listeners (connection.ts) run presence disconnect logic
      // synchronously but are themselves dispatched asynchronously relative to
      // server.shutdown() resolving; give them a tick before the DB closes under them.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await cleanupDb();
    },
  };
}

Deno.test("WS profile/preferences: get, update, and round-trip through real handlers", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const { userId, accessToken } = await registerUser("alice");
    const { socket, queue } = await connectAsSoleUser(accessToken);

    send(socket, "1", "profile.get", { userId });
    const profileResponse = await queue.next() as {
      success: boolean;
      data: { profile: { username: string } };
    };
    assertEquals(profileResponse.success, true);
    assertEquals(profileResponse.data.profile.username.startsWith("alice_"), true);

    send(socket, "2", "profile.update", { displayName: "New Name", coverIndex: 2 });
    const updateResponse = await queue.next() as {
      success: boolean;
      data: { profile: { displayName: string; coverIndex: number } };
    };
    assertEquals(updateResponse.success, true);
    assertEquals(updateResponse.data.profile.displayName, "New Name");
    assertEquals(updateResponse.data.profile.coverIndex, 2);

    // isPremium round-trip: true, then explicitly false (must not be swallowed
    // by the COALESCE update — explicit false binds 0, not NULL).
    send(socket, "2p", "profile.update", { isPremium: true });
    const premiumOn = await queue.next() as {
      success: boolean;
      data: { profile: { isPremium: boolean } };
    };
    assertEquals(premiumOn.success, true);
    assertEquals(premiumOn.data.profile.isPremium, true);

    send(socket, "2q", "profile.update", { isPremium: false });
    const premiumOff = await queue.next() as {
      success: boolean;
      data: { profile: { isPremium: boolean } };
    };
    assertEquals(premiumOff.success, true);
    assertEquals(premiumOff.data.profile.isPremium, false);

    send(socket, "3", "preferences.get", {});
    const preferencesResponse = await queue.next() as {
      success: boolean;
      data: { preferences: { theme: string; locale: string | null } };
    };
    assertEquals(preferencesResponse.success, true);
    assertEquals(preferencesResponse.data.preferences.theme, "dark");
    assertEquals(preferencesResponse.data.preferences.locale, null);

    send(socket, "4", "preferences.update", { theme: "light", sound: false, locale: "tr" });
    const preferencesUpdateResponse = await queue.next() as {
      success: boolean;
      data: { preferences: { theme: string; sound: boolean; locale: string } };
    };
    assertEquals(preferencesUpdateResponse.success, true);
    assertEquals(preferencesUpdateResponse.data.preferences.theme, "light");
    assertEquals(preferencesUpdateResponse.data.preferences.sound, false);
    assertEquals(preferencesUpdateResponse.data.preferences.locale, "tr");

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS profile/preferences updates validate patches before hitting repositories", async () => {
  const { registerUser, connectAsSoleUser, cleanup } = await bootTestServer();
  try {
    const { accessToken } = await registerUser("bob");
    const { socket, queue } = await connectAsSoleUser(accessToken);

    send(socket, "1", "profile.update", { nameColor: "not-a-hex-color" });
    const response = await queue.next() as { success: boolean; error: { code: string } };
    assertEquals(response.success, false);
    assertEquals(response.error.code, "VALIDATION_ERROR");

    send(socket, "2", "preferences.update", { locale: "fr" });
    const localeResponse = await queue.next() as { success: boolean; error: { code: string } };
    assertEquals(localeResponse.success, false);
    assertEquals(localeResponse.error.code, "VALIDATION_ERROR");

    socket.close();
  } finally {
    await cleanup();
  }
});

Deno.test("WS presence: explicit presence.update broadcasts presence.updated to every connected client, including the sender", async () => {
  const { registerUser, connectWithQueue, cleanup } = await bootTestServer();
  try {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    // Connecting is itself a presence transition (offline -> online) and broadcastToAll
    // fans out to every currently-registered connection, including the one that just
    // triggered it — each queue below must drain its own "I just came online" push
    // before the next step, or it pollutes the next assertion's message queue. Each
    // WsMessageQueue is attached before "open" resolves, so no message arriving in
    // between is ever silently dropped.
    const { socket: aliceSocket, queue: aliceQueue } = connectWithQueue(alice.accessToken);
    await waitForOpen(aliceSocket);
    const aliceObservesOwnOnline = await aliceQueue.next() as {
      event: string;
      data: { userId: string };
    };
    assertEquals(aliceObservesOwnOnline.event, "presence.updated");
    assertEquals(aliceObservesOwnOnline.data.userId, alice.userId);

    const { socket: bobSocket, queue: bobQueue } = connectWithQueue(bob.accessToken);
    await waitForOpen(bobSocket);
    const [aliceObservesBobOnline, bobObservesOwnOnline] = await Promise.all([
      aliceQueue.next(),
      bobQueue.next(),
    ]) as [
      { event: string; data: { userId: string } },
      { event: string; data: { userId: string } },
    ];
    assertEquals(aliceObservesBobOnline.event, "presence.updated");
    assertEquals(aliceObservesBobOnline.data.userId, bob.userId);
    assertEquals(bobObservesOwnOnline.event, "presence.updated");
    assertEquals(bobObservesOwnOnline.data.userId, bob.userId);

    send(aliceSocket, "1", "presence.update", { status: "dnd" });
    const [alicePush, bobPush] = await Promise.all([aliceQueue.next(), bobQueue.next()]) as [
      { event: string; data: unknown },
      { event: string; data: unknown },
    ];
    const aliceAck = await aliceQueue.next() as { id: string; success: boolean };

    const expectedTransition = { userId: alice.userId, status: "dnd", lastSeenAt: null };
    assertEquals(alicePush.event, "presence.updated");
    assertEquals(alicePush.data, expectedTransition);
    assertEquals(bobPush.event, "presence.updated");
    assertEquals(bobPush.data, expectedTransition);

    assertEquals(aliceAck.id, "1");
    assertEquals(aliceAck.success, true);

    aliceSocket.close();
    bobSocket.close();
  } finally {
    await cleanup();
  }
});
