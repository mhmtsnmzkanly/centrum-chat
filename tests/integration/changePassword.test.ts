import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { ChangePasswordRoute } from "../../src/application/http/routes/auth/changePasswordRoute.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";

async function bootTestServer() {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-change-password");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  const rateLimiter = new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 });

  const userRepository = new SqliteUserRepository(db);
  const authService = new AuthService(
    userRepository,
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );

  const changePasswordRoute = new ChangePasswordRoute(authService, tokenService, codec);
  const loginRoute = new LoginRoute(authService, rateLimiter, codec);
  registry.register(changePasswordRoute);
  registry.register(loginRoute);

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    wsUpgrade: () => {
      throw new Error("WS not used in this test");
    },
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
    return { ...result, email: `${label}_${suffix}@example.com` };
  }

  return {
    port,
    registerUser,
    cleanup: async () => {
      await server.shutdown();
      await cleanupDb();
    },
  };
}

Deno.test("HTTP change-password: changes password and restricts old login, permits new login", async () => {
  const { port, registerUser, cleanup } = await bootTestServer();
  try {
    const userResult = await registerUser("alice");

    // 1. Change password using the old credentials
    const changeResp = await fetch(`http://127.0.0.1:${port}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userResult.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "new-secure-password",
      }),
    });
    const changeJson = await changeResp.json();
    assertEquals(changeResp.status, 200);
    assertEquals(changeJson.success, true);

    // 2. Try logging in with the old password (must fail)
    const oldLoginResp = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userResult.email,
        password: "correct-horse-battery",
      }),
    });
    const oldLoginJson = await oldLoginResp.json();
    assertEquals(oldLoginResp.status, 401);
    assertEquals(oldLoginJson.success, false);

    // 3. Log in with the new password (must succeed)
    const newLoginResp = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userResult.email,
        password: "new-secure-password",
      }),
    });
    const newLoginJson = await newLoginResp.json();
    assertEquals(newLoginResp.status, 200);
    assertEquals(newLoginJson.success, true);
    assertEquals(newLoginJson.data.user.id, userResult.profile.id);
  } finally {
    await cleanup();
  }
});
