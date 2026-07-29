import { assertEquals } from "jsr:@std/assert@1";
import { DevelopmentMailService } from "../../src/application/mail/developmentMailService.ts";
import { ResendMailService } from "../../src/application/mail/resendMailService.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";

function captureConsole() {
  const original = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);
  return {
    lines,
    restore() {
      console.log = original;
    },
  };
}

Deno.test("DevelopmentMailService logs mail events without logging raw security URLs or tokens", async () => {
  const capture = captureConsole();
  try {
    const service = new DevelopmentMailService(createLogger("info", "mail-test"));
    await service.sendVerificationEmail({
      toEmail: "alice@example.com",
      displayName: "Alice",
      verificationUrl: "https://chat.example.com/?verify_email=raw-token-value",
    });

    assertEquals(capture.lines.length, 1);
    const parsed = JSON.parse(capture.lines[0]!);
    assertEquals(parsed.message, "development mail event generated");
    assertEquals(parsed.purpose, "email_verification");
    assertEquals(parsed.toEmail, "alice@example.com");
    assertEquals(capture.lines[0]!.includes("raw-token-value"), false);
    assertEquals(capture.lines[0]!.includes("verify_email"), false);
  } finally {
    capture.restore();
  }
});

Deno.test("ResendMailService normalizes transport errors without exposing API keys or token URLs", async () => {
  const apiKey = "resend-secret-api-key";
  const rawToken = "raw-reset-token";
  const service = new ResendMailService({
    apiKey,
    fromAddress: "security@example.com",
    fromName: "CentrumChat",
    fetchImpl: () =>
      Promise.reject(
        new Error(
          `provider leaked ${apiKey} https://chat.example.com/?reset_password=${rawToken}`,
        ),
      ),
  });

  let message = "";
  try {
    await service.sendPasswordResetEmail({
      toEmail: "alice@example.com",
      displayName: "Alice",
      resetUrl: `https://chat.example.com/?reset_password=${rawToken}`,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "Resend mail request failed before receiving a response.");
  assertEquals(message.includes(apiKey), false);
  assertEquals(message.includes(rawToken), false);
});

Deno.test("ResendMailService sends branded HTML and plain text payloads", async () => {
  let request: Request | undefined;
  const service = new ResendMailService({
    apiKey: "resend-test-key",
    fromAddress: "noreply@mail.example.test",
    fromName: "CentrumChat",
    fetchImpl: (input, init) => {
      request = input instanceof Request && init === undefined ? input : new Request(input, init);
      return Promise.resolve(new Response(JSON.stringify({ id: "message-id" }), { status: 200 }));
    },
  });

  await service.sendVerificationEmail({
    toEmail: "alice@example.test",
    displayName: "Alice",
    verificationUrl: "https://chat.example.test/?verify_email=example-token",
  });

  assertEquals(request?.url, "https://api.resend.com/emails");
  assertEquals(request?.headers.get("authorization"), "Bearer resend-test-key");
  const payload = await request?.json() as Record<string, unknown>;
  assertEquals(payload.from, "CentrumChat <noreply@mail.example.test>");
  assertEquals(payload.subject, "Verify your CentrumChat email");
  assertEquals(typeof payload.html, "string");
  assertEquals(typeof payload.text, "string");
  assertEquals(String(payload.html).includes("Verify email"), true);
  assertEquals(String(payload.text).includes("https://chat.example.test/"), true);
});
