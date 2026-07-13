import { assertEquals } from "jsr:@std/assert@1";

Deno.test("web/index.js statically wires system.ping to an internal system.pong response", async () => {
  const source = await Deno.readTextFile(new URL("../../web/index.js", import.meta.url));

  assertEquals(source.includes('wsClient.addEventListener("system.ping"'), true);
  assertEquals(source.includes('wsClient.sendFireAndForget("system.pong", {})'), true);
});
