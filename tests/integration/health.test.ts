import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { HealthLiveRoute } from "../../src/application/http/routes/health/healthLiveRoute.ts";
import { HealthReadyRoute } from "../../src/application/http/routes/health/healthReadyRoute.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createTestDb } from "../support/testDatabase.ts";

Deno.test("GET /health/live returns ok status without the readiness payload", async () => {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-health");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(new HealthReadyRoute("/health", db, codec, logger));
  registry.register(new HealthReadyRoute("/health/ready", db, codec, logger));

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/live`);
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.success, true);
    assertEquals(body.data.status, "ok");
    assertEquals(body.data.db, undefined);
  } finally {
    await server.shutdown();
    await cleanupDb();
  }
});

Deno.test("GET /health and /health/ready are readiness aliases", async () => {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-health");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(new HealthReadyRoute("/health", db, codec, logger));
  registry.register(new HealthReadyRoute("/health/ready", db, codec, logger));

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;

  try {
    const alias = await fetch(`http://127.0.0.1:${port}/health`);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    const aliasBody = await alias.json();
    const readyBody = await ready.json();

    assertEquals(alias.status, 200);
    assertEquals(ready.status, 200);
    assertEquals(aliasBody, readyBody);
  } finally {
    await server.shutdown();
    await cleanupDb();
  }
});

Deno.test("GET /health/ready returns 503 without exposing SQL details when the DB check fails", async () => {
  const logger = createLogger("error", "test-health");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(
    new HealthReadyRoute(
      "/health/ready",
      {
        prepare() {
          throw new Error("sqlite exploded");
        },
      } as never,
      codec,
      logger,
    ),
  );

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.success, false);
    assertEquals(body.error.code, "UNAVAILABLE");
    assertEquals(body.error.message.includes("sqlite"), false);
  } finally {
    await server.shutdown();
  }
});

Deno.test("unmatched route returns the standard NOT_FOUND envelope", async () => {
  const { db, cleanup: cleanupDb } = await createTestDb();
  const logger = createLogger("error", "test-health");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new HealthLiveRoute(codec));
  registry.register(new HealthReadyRoute("/health", db, codec, logger));

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    const body = await response.json();

    assertEquals(response.status, 404);
    assertEquals(body.success, false);
    assertEquals(body.error.code, "NOT_FOUND");
  } finally {
    await server.shutdown();
    await cleanupDb();
  }
});
