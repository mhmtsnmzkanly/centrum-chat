import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { StaticRoute } from "../../src/application/http/routes/staticRoute.ts";

Deno.test("HTTP StaticRoute: serves index.html, index.css, index.js, and blocks traversal", async () => {
  const logger = createLogger("error", "test-static");
  const codec = new JsonCodec();
  const registry = new RouteRegistry();

  const tempDir = await Deno.makeTempDir({ prefix: "centrumchat-static-test-" });
  const htmlPath = `${tempDir}/index.html`;
  const cssPath = `${tempDir}/index.css`;
  const jsPath = `${tempDir}/index.js`;

  await Deno.writeTextFile(htmlPath, "<html>NeoChat/CentrumChat</html>");
  await Deno.writeTextFile(cssPath, "body { color: red; }");
  await Deno.writeTextFile(jsPath, "console.log('hello');");

  registry.register(new StaticRoute("*", tempDir, codec));

  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger,
    wsUpgrade: () => {
      throw new Error("WS not used");
    },
  });
  const port = (server.addr as Deno.NetAddr).port;

  try {
    // 1. GET / maps to index.html
    const htmlResp = await fetch(`http://127.0.0.1:${port}/`);
    assertEquals(htmlResp.status, 200);
    assertEquals(htmlResp.headers.get("content-type"), "text/html");
    const htmlText = await htmlResp.text();
    assertStringIncludes(htmlText, "NeoChat/CentrumChat");

    // 2. GET /index.html serves index.html
    const htmlFileResp = await fetch(`http://127.0.0.1:${port}/index.html`);
    assertEquals(htmlFileResp.status, 200);
    assertEquals(htmlFileResp.headers.get("content-type"), "text/html");
    const htmlFileText = await htmlFileResp.text();
    assertStringIncludes(htmlFileText, "NeoChat/CentrumChat");

    // 3. GET /index.css serves index.css
    const cssResp = await fetch(`http://127.0.0.1:${port}/index.css`);
    assertEquals(cssResp.status, 200);
    assertEquals(cssResp.headers.get("content-type"), "text/css");
    const cssText = await cssResp.text();
    assertStringIncludes(cssText, "body { color: red; }");

    // 4. GET /index.js serves index.js
    const jsResp = await fetch(`http://127.0.0.1:${port}/index.js`);
    assertEquals(jsResp.status, 200);
    assertEquals(jsResp.headers.get("content-type"), "application/javascript");
    const jsText = await jsResp.text();
    assertStringIncludes(jsText, "console.log('hello');");

    // 5. Test path traversal directly on the handler to bypass client-side fetch/URL normalization
    const route = new StaticRoute("*", tempDir, codec);
    const traverseResp = await route.handle({
      request: new Request(`http://127.0.0.1:${port}/%2e%2e/index.html`),
      params: { "*": "/%2e%2e/index.html" },
      clientIp: "127.0.0.1",
    });
    assertEquals(traverseResp.status, 403);
    const traverseBody = await traverseResp.json();
    assertEquals(traverseBody.error.code, "FORBIDDEN");

    const traverseResp2 = await route.handle({
      request: new Request(`http://127.0.0.1:${port}/index.html/%2e%2e/css`),
      params: { "*": "/index.html/%2e%2e/css" },
      clientIp: "127.0.0.1",
    });
    assertEquals(traverseResp2.status, 403);
    const traverseBody2 = await traverseResp2.json();
    assertEquals(traverseBody2.error.code, "FORBIDDEN");
  } finally {
    await server.shutdown();
    await Deno.remove(tempDir, { recursive: true });
  }
});
