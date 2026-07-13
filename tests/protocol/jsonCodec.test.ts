import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { isInboundEnvelope, protocolErrorPush } from "../../src/protocol/envelopes.ts";

Deno.test("JsonCodec encode/decode roundtrips an InboundEnvelope", () => {
  const codec = new JsonCodec();
  const original = {
    id: "c-1",
    event: "message.send",
    data: { conversationId: "r1", content: "hi" },
  };

  const encoded = codec.encode(original);
  const decoded = codec.decode(encoded);

  assertEquals(decoded, original);
});

Deno.test("JsonCodec.decode throws on malformed JSON", () => {
  const codec = new JsonCodec();
  assertThrows(() => codec.decode("{not valid json"));
});

Deno.test("JsonCodec.encode/decode roundtrips binary (Uint8Array) input", () => {
  const codec = new JsonCodec();
  const bytes = new TextEncoder().encode(JSON.stringify({ id: "c-2", event: "x", data: null }));

  const decoded = codec.decode(bytes);

  assertEquals(decoded, { id: "c-2", event: "x", data: null });
});

Deno.test("isInboundEnvelope accepts a well-formed envelope", () => {
  assertEquals(isInboundEnvelope({ id: "c-1", event: "presence.update", data: {} }), true);
});

Deno.test("isInboundEnvelope rejects missing id/event/data", () => {
  assertEquals(isInboundEnvelope({ event: "x", data: {} }), false);
  assertEquals(isInboundEnvelope({ id: "c-1", data: {} }), false);
  assertEquals(isInboundEnvelope({ id: "c-1", event: "x" }), false);
  assertEquals(isInboundEnvelope("just a string"), false);
  assertEquals(isInboundEnvelope(null), false);
  assertEquals(isInboundEnvelope(42), false);
});

Deno.test("protocolErrorPush shapes an unsolicited push with no id", () => {
  const push = protocolErrorPush({ code: "VALIDATION_ERROR", message: "bad payload" });
  assertEquals(push, {
    event: "protocol.error",
    data: { code: "VALIDATION_ERROR", message: "bad payload" },
  });
});
