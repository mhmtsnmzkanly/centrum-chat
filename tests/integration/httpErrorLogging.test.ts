import { assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import type { HttpRequestContext, RouteHandler } from "../../src/application/http/routeHandler.ts";

/** Always throws a plain (non-DomainError) Error, standing in for a genuine bug — the
 * only case `errorBoundary.ts` actually writes a log line for. */
class ThrowingRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/boom";
  handle(_ctx: HttpRequestContext): Response {
    throw new Error("kaboom");
  }
}

Deno.test("An unexpected HTTP route error is logged with method/path/clientIp context", async () => {
  const logger = createLogger("error", "test-http-error-logging");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  registry.register(new ThrowingRoute());

  const server = startHttpServer({ host: "127.0.0.1", port: 0, registry, codec, logger });
  const port = (server.addr as Deno.NetAddr).port;

  const originalConsoleError = console.error;
  const capturedLines: string[] = [];
  console.error = (line: string) => capturedLines.push(line);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    const body = await response.json();
    assertEquals(response.status, 500);
    assertEquals(body.error.code, "INTERNAL_ERROR");

    assertEquals(capturedLines.length, 1);
    const logged = JSON.parse(capturedLines[0]!);
    assertEquals(logged.level, "error");
    assertEquals(logged.method, "GET");
    assertEquals(logged.path, "/boom");
    assertEquals(typeof logged.clientIp, "string");
    assertEquals(logged.clientIp.length > 0, true);
  } finally {
    console.error = originalConsoleError;
    await server.shutdown();
  }
});
