import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { HealthReadyRoute } from "../../src/application/http/routes/health/healthReadyRoute.ts";
import { RegisterRoute } from "../../src/application/http/routes/auth/registerRoute.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";
import { RefreshRoute } from "../../src/application/http/routes/auth/refreshRoute.ts";
import { LogoutRoute } from "../../src/application/http/routes/auth/logoutRoute.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";

async function bootAuthTestServer(
  loginRateLimit = { maxTokens: 10, refillIntervalMs: 60_000 },
) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-auth");
  const codec = new JsonCodec();
  const authService = new AuthService(
    new SqliteUserRepository(db),
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    new TokenService({ secret: "integration-test-secret", accessTokenTtlSeconds: 900 }),
    2592000,
  );

  const registry = new RouteRegistry();
  registry.register(new HealthReadyRoute("/health", db, codec, logger));
  registry.register(new RegisterRoute(authService, codec));
  registry.register(
    new LoginRoute(authService, new RateLimiter(loginRateLimit), codec),
  );
  registry.register(new RefreshRoute(authService, codec));
  registry.register(
    new LogoutRoute(
      authService,
      new TokenService({ secret: "integration-test-secret", accessTokenTtlSeconds: 900 }),
      codec,
    ),
  );

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    cleanup: async () => {
      await server.shutdown();
      await cleanupDb();
    },
  };
}

Deno.test("Auth HTTP flow: register -> duplicate register -> login -> wrong password -> refresh -> logout -> revoked refresh fails", async () => {
  const { baseUrl, cleanup } = await bootAuthTestServer();
  try {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        username: "alice",
        email: "alice@example.com",
        password: "correct-horse-battery",
        displayName: "Alice",
      }),
    });
    assertEquals(registerResponse.status, 201);
    const registerBody = await registerResponse.json();
    assertEquals(registerBody.success, true);
    assertEquals(registerBody.data.user.username, "alice");
    assert(typeof registerBody.data.accessToken === "string");
    assert(typeof registerBody.data.refreshToken === "string");

    const duplicateResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        username: "alice",
        email: "alice@example.com",
        password: "another-password",
        displayName: "Alice Two",
      }),
    });
    assertEquals(duplicateResponse.status, 409);
    const duplicateBody = await duplicateResponse.json();
    assertEquals(duplicateBody.success, false);
    assertEquals(duplicateBody.error.code, "CONFLICT");

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "alice@example.com", password: "correct-horse-battery" }),
    });
    assertEquals(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    assertEquals(loginBody.success, true);

    const wrongPasswordResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "alice@example.com", password: "not-the-password" }),
    });
    assertEquals(wrongPasswordResponse.status, 401);
    const wrongPasswordBody = await wrongPasswordResponse.json();
    assertEquals(wrongPasswordBody.error.code, "UNAUTHORIZED");

    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: loginBody.data.refreshToken }),
    });
    assertEquals(refreshResponse.status, 200);
    const refreshBody = await refreshResponse.json();
    assert(refreshBody.data.refreshToken !== loginBody.data.refreshToken);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${refreshBody.data.accessToken}` },
      body: JSON.stringify({ refreshToken: refreshBody.data.refreshToken }),
    });
    assertEquals(logoutResponse.status, 200);
    await logoutResponse.json();

    const staleRefreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: refreshBody.data.refreshToken }),
    });
    assertEquals(staleRefreshResponse.status, 401);
    await staleRefreshResponse.json();
  } finally {
    await cleanup();
  }
});

Deno.test("Auth HTTP flow: logout without a bearer token is rejected", async () => {
  const { baseUrl, cleanup } = await bootAuthTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: "does-not-matter" }),
    });
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error.code, "UNAUTHORIZED");
  } finally {
    await cleanup();
  }
});

Deno.test("Auth HTTP flow: register validates input shape", async () => {
  const { baseUrl, cleanup } = await bootAuthTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        username: "al",
        email: "not-an-email",
        password: "short",
        displayName: "",
      }),
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    await cleanup();
  }
});

Deno.test("Auth HTTP flow: a malformed JSON body is a VALIDATION_ERROR (400), not INTERNAL_ERROR (500)", async () => {
  const { baseUrl, cleanup } = await bootAuthTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: "{not valid json",
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/auth/login is rate-limited by IP", async () => {
  const { baseUrl, cleanup } = await bootAuthTestServer({ maxTokens: 1, refillIntervalMs: 60_000 });
  try {
    const attempt = () =>
      fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
      });

    const first = await attempt();
    assertEquals(first.status, 401); // unknown email, but consumes the one token
    await first.body?.cancel();

    const second = await attempt();
    assertEquals(second.status, 429);
    const body = await second.json();
    assertEquals(body.error.code, "RATE_LIMITED");
  } finally {
    await cleanup();
  }
});
