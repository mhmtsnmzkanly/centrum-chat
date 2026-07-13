import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { ControlCenterStaticRoute } from "../../src/application/http/routes/controlCenterStaticRoute.ts";
import { StaticRoute } from "../../src/application/http/routes/staticRoute.ts";
import type { RouteHandler } from "../../src/application/http/routeHandler.ts";
import { successResponse } from "../../src/application/http/responses.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";

Deno.test("Control Center static routes serve only production allow-listed assets", async () => {
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const api: RouteHandler = {
    method: "GET",
    path: "/api/control-center/me",
    handle: () => Promise.resolve(successResponse(codec, { route: "api" }, 200)),
  };
  registry.register(api);
  const webDir = new URL("../../web", import.meta.url).pathname;
  const controlCenterDir = new URL("../../web/control-center", import.meta.url).pathname;
  registry.register(
    new ControlCenterStaticRoute("/control-center", controlCenterDir, codec),
  );
  registry.register(
    new ControlCenterStaticRoute("/control-center/*", controlCenterDir, codec),
  );
  registry.register(new StaticRoute("*", webDir, codec));
  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger: createLogger("error", "control-center-static-test"),
  });
  const base = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  try {
    for (
      const path of [
        "/control-center",
        "/control-center/",
        "/control-center/index.html",
      ]
    ) {
      const response = await fetch(base + path);
      assertEquals(response.status, 200);
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        "text/html",
      );
    }
    for (
      const path of [
        "/control-center/control-center.css",
        "/control-center/control-center.js",
        "/control-center/api/controlCenterApi.js",
        "/control-center/ui/users.js",
      ]
    ) {
      const response = await fetch(base + path);
      assertEquals(response.status, 200);
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        path.endsWith(".css") ? "text/css" : "text/javascript",
      );
    }
    for (
      const path of [
        "/control-center/missing.js",
        "/control-center/tests/controlCenter.static.test.ts",
        "/control-center/fixtures/developmentFixtures.js",
        "/control-center/README.md",
        "/control-center/AGENT_BOUNDARY.md",
      ]
    ) {
      assertEquals((await fetch(base + path)).status, 404);
    }
    const apiResponse = await fetch(base + "/api/control-center/me");
    assertEquals((await apiResponse.json()).data.route, "api");
    assertEquals((await fetch(base + "/")).status, 200);
    const direct = new ControlCenterStaticRoute(
      "/control-center/*",
      controlCenterDir,
      codec,
    );
    const traversal = await direct.handle({
      request: new Request(base + "/control-center/file"),
      params: { "*": "../index.js" },
      clientIp: "127.0.0.1",
    });
    assertEquals(traversal.status, 404);
  } finally {
    await server.shutdown();
  }
});
