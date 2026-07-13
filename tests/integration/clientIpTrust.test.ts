import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { LoginRoute } from "../../src/application/http/routes/auth/loginRoute.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { WebCryptoPasswordHasher } from "../../src/domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { AuthService } from "../../src/domain/auth/authService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { SystemPongHandler } from "../../src/application/websocket/handlers/system/systemPongHandler.ts";

// Integration coverage for the trusted-proxy client-IP policy
// (src/shared/security/clientIp.ts): IP-keyed HTTP rate-limit buckets and the
// WebSocket per-IP connection quota must key off the *resolved* client IP —
// forwarded headers honored only from a trusted peer, ignored otherwise.

async function bootServer(options: {
  trustedProxies?: readonly string[];
  loginRateLimit?: { maxTokens: number; refillIntervalMs: number };
  maxConnectionsPerIp?: number;
}) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-client-ip");
  const codec = new JsonCodec();
  const tokenService = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
  const authService = new AuthService(
    new SqliteUserRepository(db),
    new SqliteUserSessionRepository(db),
    new WebCryptoPasswordHasher(),
    tokenService,
    2592000,
  );

  const registry = new RouteRegistry();
  registry.register(
    new LoginRoute(
      authService,
      new RateLimiter(options.loginRateLimit ?? { maxTokens: 2, refillIntervalMs: 60_000 }),
      codec,
    ),
  );

  const wsRegistry = new WebSocketHandlerRegistry();
  wsRegistry.register(new SystemPongHandler());
  const connectionManager = new ConnectionManager({
    maxConnectionsPerUser: 10,
    maxConnectionsPerIp: options.maxConnectionsPerIp ?? 2,
    logger,
  });

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    ...(options.trustedProxies === undefined ? {} : { trustedProxies: options.trustedProxies }),
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

  async function issueAccessToken(): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const result = await authService.register({
      username: `user_${suffix}`,
      email: `user_${suffix}@example.com`,
      password: "correct-horse-battery",
      displayName: "Test User",
    });
    return result.accessToken;
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    issueAccessToken,
    cleanup: async () => {
      connectionManager.shutdownAllConnections();
      await server.shutdown();
      await cleanupDb();
      // Let socket "close" listeners finish before the sanitizer checks leaks.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

async function loginErrorCode(
  baseUrl: string,
  forwardedFor: string | null,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (forwardedFor !== null) headers["X-Forwarded-For"] = forwardedFor;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
  });
  const body = await response.json();
  return body.error?.code ?? "SUCCESS";
}

/**
 * Minimal raw WebSocket handshake so the test can attach an X-Forwarded-For header —
 * the browser-style `new WebSocket()` client cannot set custom headers. Only the
 * response status matters (101 admitted / 429 quota); the TCP connection is held open
 * to keep the admission slot occupied.
 */
async function rawWsHandshake(
  port: number,
  token: string,
  forwardedFor: string | null,
): Promise<{ status: number; close: () => void }> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const lines = [
    `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
  ];
  if (forwardedFor !== null) lines.push(`X-Forwarded-For: ${forwardedFor}`);
  const request = lines.join("\r\n") + "\r\n\r\n";
  await conn.write(new TextEncoder().encode(request));

  const buffer = new Uint8Array(2048);
  const bytesRead = await conn.read(buffer);
  const head = new TextDecoder().decode(buffer.subarray(0, bytesRead ?? 0));
  const status = Number.parseInt(head.split(" ")[1] ?? "0", 10);
  const close = () => {
    try {
      conn.close();
    } catch {
      // already closed by the server (non-101 responses)
    }
  };
  return { status, close };
}

Deno.test("HTTP login rate limit keys off the forwarded IP behind a trusted proxy", async () => {
  const { baseUrl, cleanup } = await bootServer({
    trustedProxies: ["127.0.0.1"],
    loginRateLimit: { maxTokens: 2, refillIntervalMs: 60_000 },
  });
  try {
    // Client A (attested by the trusted loopback proxy) exhausts its own bucket...
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.1"), "UNAUTHORIZED");
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.1"), "UNAUTHORIZED");
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.1"), "RATE_LIMITED");
    // ...and stays limited on a fresh connection: the key is the IP, not the socket.
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.1"), "RATE_LIMITED");
    // Client B does not share client A's bucket.
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.2"), "UNAUTHORIZED");
  } finally {
    await cleanup();
  }
});

Deno.test("HTTP spoofed X-Forwarded-For from an untrusted peer cannot escape the shared bucket", async () => {
  const { baseUrl, cleanup } = await bootServer({
    trustedProxies: [], // nobody trusted: the socket peer is always the client
    loginRateLimit: { maxTokens: 2, refillIntervalMs: 60_000 },
  });
  try {
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.1"), "UNAUTHORIZED");
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.2"), "UNAUTHORIZED");
    // Rotating the spoofed header does not mint a new bucket — still the socket IP.
    assertEquals(await loginErrorCode(baseUrl, "203.0.113.3"), "RATE_LIMITED");
    assertEquals(await loginErrorCode(baseUrl, null), "RATE_LIMITED");
  } finally {
    await cleanup();
  }
});

Deno.test("WS per-IP quota keys off the forwarded IP behind a trusted proxy", async () => {
  const { port, issueAccessToken, cleanup } = await bootServer({
    trustedProxies: ["127.0.0.1"],
    maxConnectionsPerIp: 2,
  });
  const open: Array<{ close: () => void }> = [];
  try {
    const token = await issueAccessToken();

    const first = await rawWsHandshake(port, token, "203.0.113.50");
    open.push(first);
    assertEquals(first.status, 101);

    const second = await rawWsHandshake(port, token, "203.0.113.50");
    open.push(second);
    assertEquals(second.status, 101);

    // Third connection from the same real client is over quota...
    const third = await rawWsHandshake(port, token, "203.0.113.50");
    open.push(third);
    assertEquals(third.status, 429);

    // ...but a different real client behind the same proxy is unaffected.
    const otherClient = await rawWsHandshake(port, token, "203.0.113.51");
    open.push(otherClient);
    assertEquals(otherClient.status, 101);
  } finally {
    for (const conn of open) conn.close();
    await cleanup();
  }
});

Deno.test("WS spoofed X-Forwarded-For from an untrusted peer cannot escape the per-IP quota", async () => {
  const { port, issueAccessToken, cleanup } = await bootServer({
    trustedProxies: [],
    maxConnectionsPerIp: 2,
  });
  const open: Array<{ close: () => void }> = [];
  try {
    const token = await issueAccessToken();

    const first = await rawWsHandshake(port, token, "203.0.113.60");
    open.push(first);
    assertEquals(first.status, 101);

    const second = await rawWsHandshake(port, token, "203.0.113.61");
    open.push(second);
    assertEquals(second.status, 101);

    // Every connection above came from 127.0.0.1; rotating the spoofed header does
    // not create fresh quota buckets.
    const third = await rawWsHandshake(port, token, "203.0.113.62");
    open.push(third);
    assertEquals(third.status, 429);
  } finally {
    for (const conn of open) conn.close();
    await cleanup();
  }
});
