import { assertEquals } from "jsr:@std/assert@1";
import { DevelopmentCaptchaVerifier } from "../../src/application/captcha/developmentCaptchaVerifier.ts";
import { TurnstileCaptchaVerifier } from "../../src/application/captcha/turnstileCaptchaVerifier.ts";

Deno.test("DevelopmentCaptchaVerifier is an explicit development bypass", async () => {
  const verifier = new DevelopmentCaptchaVerifier();
  assertEquals(
    await verifier.verify(null, { action: "register", clientIp: "127.0.0.1" }),
    true,
  );
});

Deno.test("TurnstileCaptchaVerifier sends actual peer context and fails closed on invalid/provider failure", async () => {
  let requestBody = "";
  const verifier = new TurnstileCaptchaVerifier({
    secretKey: "server-secret",
    expectedHostname: "chat.example.com",
    fetchImpl: (_input, init) => {
      requestBody = String(init?.body);
      return Promise.resolve(Response.json({
        success: true,
        hostname: "chat.example.com",
        action: "register",
      }));
    },
  });
  assertEquals(
    await verifier.verify("client-token", { action: "register", clientIp: "203.0.113.5" }),
    true,
  );
  assertEquals(requestBody.includes("secret=server-secret"), true);
  assertEquals(requestBody.includes("remoteip=203.0.113.5"), true);
  assertEquals(await verifier.verify(null, { action: "register", clientIp: "x" }), false);

  const failing = new TurnstileCaptchaVerifier({
    secretKey: "secret",
    expectedHostname: "chat.example.com",
    fetchImpl: () => Promise.reject(new Error("provider unavailable with secret")),
  });
  assertEquals(
    await failing.verify("token", { action: "login", clientIp: "127.0.0.1" }),
    false,
  );
});
