import { assertEquals } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";

Deno.test("handleWsUpgrade rejects a disallowed Origin before upgrading the socket", async () => {
  const response = await handleWsUpgrade(
    new Request("http://127.0.0.1:8080/ws?token=whatever", {
      headers: {
        upgrade: "websocket",
        origin: "https://evil.example.com",
      },
    }),
    {
      registry: { dispatch: () => Promise.reject(new Error("unused")) } as never,
      connectionManager: new ConnectionManager(),
      codec: new JsonCodec(),
      clientIp: "127.0.0.1",
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
      tokenService: {} as never,
      allowedOrigins: ["https://app.example.com"],
    },
  );

  assertEquals(response.status, 403);
});
