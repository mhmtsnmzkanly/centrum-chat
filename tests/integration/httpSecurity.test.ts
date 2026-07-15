import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { HealthLiveRoute } from "../../src/application/http/routes/health/healthLiveRoute.ts";
import { HealthReadyRoute } from "../../src/application/http/routes/health/healthReadyRoute.ts";
import { StaticRoute } from "../../src/application/http/routes/staticRoute.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";

async function bootServer(allowedOrigins: readonly string[] = []) {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-http-security");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(new HealthReadyRoute("/health", db, codec, logger));
  const webDir = new URL("../../web", import.meta.url).pathname;
  registry.register(new StaticRoute("*", webDir, codec));

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    allowedOrigins,
  });
  const port = (server.addr as Deno.NetAddr).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup: async () => {
      await server.shutdown();
      await cleanupDb();
    },
  };
}

Deno.test("HTTP responses include the baseline security headers and HTML CSP", async () => {
  const { baseUrl, cleanup } = await bootServer();
  try {
    const health = await fetch(`${baseUrl}/health`);
    assertEquals(health.headers.get("x-content-type-options"), "nosniff");
    assertEquals(health.headers.get("x-frame-options"), "DENY");
    assertEquals(health.headers.get("referrer-policy"), "no-referrer");
    assertEquals(health.headers.get("cross-origin-opener-policy"), "same-origin");
    assertEquals(health.headers.get("cross-origin-resource-policy"), "same-origin");
    assertEquals(health.headers.get("strict-transport-security"), null);
    assert(health.headers.get("permissions-policy")?.includes("camera=()"));
    await health.body?.cancel();

    const page = await fetch(`${baseUrl}/`);
    const csp = page.headers.get("content-security-policy");
    assert(csp !== null);
    assert(csp.includes("default-src 'self'"));
    assert(csp.includes("script-src 'self'"));
    await page.body?.cancel();

    const authPage = await fetch(`${baseUrl}/auth.html`);
    const authCsp = authPage.headers.get("content-security-policy");
    assert(authCsp?.includes("https://challenges.cloudflare.com"));
    assertEquals(authCsp?.includes("'unsafe-eval'"), false);
    await authPage.body?.cancel();
  } finally {
    await cleanup();
  }
});

Deno.test("HTTP HSTS is emitted only when explicitly enabled, and forwarded-header spoofing does not affect it", async () => {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-http-security");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(new HealthReadyRoute("/health", db, codec, logger));

  const disabledServer = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    enableHsts: false,
  });
  const disabledPort = (disabledServer.addr as Deno.NetAddr).port;

  const enabledServer = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    enableHsts: true,
  });
  const enabledPort = (enabledServer.addr as Deno.NetAddr).port;

  try {
    const disabled = await fetch(`http://127.0.0.1:${disabledPort}/health`, {
      headers: { "x-forwarded-proto": "https" },
    });
    const enabled = await fetch(`http://127.0.0.1:${enabledPort}/health`);

    assertEquals(disabled.headers.get("strict-transport-security"), null);
    assertEquals(
      enabled.headers.get("strict-transport-security"),
      "max-age=15552000; includeSubDomains",
    );
  } finally {
    await disabledServer.shutdown();
    await enabledServer.shutdown();
    await cleanupDb();
  }
});

Deno.test("HTTP CORS preflight allows configured origins and rejects unconfigured ones", async () => {
  const { baseUrl, cleanup } = await bootServer(["https://app.example.com"]);
  try {
    const allowed = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
      },
    });
    assertEquals(allowed.status, 204);
    assertEquals(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
    assertEquals(allowed.headers.get("access-control-allow-methods")?.includes("PATCH"), true);
    await allowed.body?.cancel();

    const rejected = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    assertEquals(rejected.status, 403);
    await rejected.body?.cancel();

    const normal = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://evil.example.com" },
    });
    assertEquals(normal.headers.get("access-control-allow-origin"), null);
    await normal.body?.cancel();
  } finally {
    await cleanup();
  }
});
