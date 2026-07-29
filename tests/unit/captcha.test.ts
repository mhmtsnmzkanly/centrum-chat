import { assertEquals } from "jsr:@std/assert@1";
import { DevelopmentCaptchaVerifier } from "../../src/application/captcha/developmentCaptchaVerifier.ts";
import { TurnstileCaptchaVerifier } from "../../src/application/captcha/turnstileCaptchaVerifier.ts";

const context = { action: "register" as const, clientIp: "203.0.113.5" };

Deno.test("DevelopmentCaptchaVerifier is an explicit development bypass", async () => {
  assertEquals(await new DevelopmentCaptchaVerifier().verify(null, context), { status: "verified" });
});

Deno.test("TurnstileCaptchaVerifier validates success, action, hostname and request context", async () => {
  let requestBody = "";
  const verifier = new TurnstileCaptchaVerifier({
    secretKey: "server-secret",
    expectedHostnames: ["chat.example.com", "staging.example.com"],
    timeoutMs: 100,
    fetchImpl: (_input, init) => {
      requestBody = String(init?.body);
      return Promise.resolve(Response.json({ success: true, hostname: "chat.example.com", action: "register" }));
    },
  });
  assertEquals(await verifier.verify("client-token", context), { status: "verified" });
  assertEquals(requestBody.includes("secret=server-secret"), true);
  assertEquals(requestBody.includes("remoteip=203.0.113.5"), true);
  assertEquals(requestBody.includes("idempotency_key="), true);
});

Deno.test("TurnstileCaptchaVerifier rejects malformed tokens and provider mismatches before exposing provider details", async () => {
  let calls = 0;
  const verifier = new TurnstileCaptchaVerifier({
    secretKey: "server-secret",
    expectedHostnames: ["chat.example.com"],
    timeoutMs: 100,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(Response.json({ success: true, hostname: "other.example.com", action: "register" }));
    },
  });
  assertEquals(await verifier.verify(null, context), { status: "invalid", reason: "missing" });
  assertEquals(await verifier.verify("x".repeat(2_049), context), { status: "invalid", reason: "rejected" });
  assertEquals(calls, 0);
  assertEquals(await verifier.verify("token", context), { status: "invalid", reason: "hostname-mismatch" });
});

Deno.test("TurnstileCaptchaVerifier maps rejected, action mismatch, malformed and unavailable responses safely", async () => {
  const cases: Array<[Response | Error, unknown]> = [
    [Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: "invalid", reason: "expired" }],
    [Response.json({ success: true, hostname: "chat.example.com", action: "login" }), { status: "invalid", reason: "action-mismatch" }],
    [Response.json({ success: "yes" }), { status: "invalid", reason: "malformed-response" }],
    [new Error("provider unavailable with server-secret and client-token"), { status: "unavailable" }],
    [new Response("upstream failed", { status: 503 }), { status: "unavailable" }],
  ];
  for (const [result, expected] of cases) {
    const verifier = new TurnstileCaptchaVerifier({
      secretKey: "server-secret",
      expectedHostnames: ["chat.example.com"],
      timeoutMs: 100,
      fetchImpl: () => result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    });
    assertEquals(await verifier.verify("client-token", context), expected);
  }
});
