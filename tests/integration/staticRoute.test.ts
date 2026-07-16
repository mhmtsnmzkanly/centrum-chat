import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { StaticRoute } from "../../src/application/http/routes/staticRoute.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";

Deno.test("StaticRoute resolves exact, extensionless, and directory fallback paths correctly", async () => {
  const codec = new JsonCodec();
  const registry = new RouteRegistry();
  const webDir = new URL("../../web", import.meta.url).pathname;

  registry.register(new StaticRoute("*", webDir, codec));

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger: createLogger("error", "static-route-test"),
  });
  const base = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;

  try {
    // 1. Root and index.html mapping
    for (const path of ["/", "/index.html"]) {
      const response = await fetch(base + path);
      assertEquals(response.status, 200);
      assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
    }

    // 2. Extensionless resolution
    const responseCC = await fetch(base + "/control-center");
    assertEquals(responseCC.status, 200);
    assertStringIncludes(responseCC.headers.get("content-type") ?? "", "text/html");

    const responseCCHtml = await fetch(base + "/control-center.html");
    assertEquals(responseCCHtml.status, 200);
    assertStringIncludes(responseCCHtml.headers.get("content-type") ?? "", "text/html");

    const responseAuth = await fetch(base + "/auth.html?returnTo=%2Fcontrol-center");
    assertEquals(responseAuth.status, 200);
    assertStringIncludes(responseAuth.headers.get("content-type") ?? "", "text/html");

    // 3. CSS and JS exact requests
    const responseCSS = await fetch(base + "/styles/chat.css");
    assertEquals(responseCSS.status, 200);
    assertStringIncludes(responseCSS.headers.get("content-type") ?? "", "text/css");

    const responseJS = await fetch(base + "/scripts/chat.js");
    assertEquals(responseJS.status, 200);
    assertStringIncludes(responseJS.headers.get("content-type") ?? "", "application/javascript");

    for (
      const path of [
        "/scripts/auth.js",
        "/scripts/shared-auth.js",
        "/scripts/i18n.js",
        "/scripts/i18n-catalogs.js",
        "/scripts/account-locale.js",
      ]
    ) {
      const response = await fetch(base + path);
      assertEquals(response.status, 200);
      assertStringIncludes(response.headers.get("content-type") ?? "", "application/javascript");
    }

    const responseAuthCSS = await fetch(base + "/styles/auth.css");
    assertEquals(responseAuthCSS.status, 200);
    assertStringIncludes(responseAuthCSS.headers.get("content-type") ?? "", "text/css");

    // 4. Query parameters do not affect resolution
    const responseQuery = await fetch(base + "/control-center?tab=users");
    assertEquals(responseQuery.status, 200);
    assertStringIncludes(responseQuery.headers.get("content-type") ?? "", "text/html");

    // 5. Missing path
    const responseMissing = await fetch(base + "/non-existent-file-path-xyz.html");
    assertEquals(responseMissing.status, 404);

    // 6. Traversal prevention (tested directly on the route handler)
    const route = new StaticRoute("*", webDir, codec);

    const resDirect1 = await route.handle({
      request: new Request("http://localhost/../src/main.ts"),
      params: { "*": "../src/main.ts" },
      clientIp: "127.0.0.1",
    });
    assertEquals(resDirect1.status, 403);

    const resDirect2 = await route.handle({
      request: new Request("http://localhost/%2e%2e/src/main.ts"),
      params: { "*": "%2e%2e/src/main.ts" },
      clientIp: "127.0.0.1",
    });
    assertEquals(resDirect2.status, 403);
  } finally {
    await server.shutdown();
  }
});
