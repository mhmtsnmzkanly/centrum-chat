import { assertEquals } from "jsr:@std/assert@1";

Deno.test("web/index.js statically implements split remembered/session token storage and security query handling", async () => {
  const source = await Deno.readTextFile(new URL("../../web/index.js", import.meta.url));

  assertEquals(source.includes("window.localStorage"), true);
  assertEquals(source.includes("window.sessionStorage"), true);
  assertEquals(source.includes("chat_session_tokens_persistent"), true);
  assertEquals(source.includes("chat_session_tokens_session"), true);
  assertEquals(source.includes("if (rememberMe)"), true);
  assertEquals(source.includes('store.set("authState.pendingEmailChangeToken"'), true);
  assertEquals(source.includes('url.searchParams.get("verify_email")'), true);
  assertEquals(source.includes('url.searchParams.get("reset_password")'), true);
  assertEquals(source.includes('url.searchParams.get("change_email")'), true);
});

Deno.test("web/index.html statically exposes remember-me, password-reset, verification, email-change, and session-management controls", async () => {
  const source = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));

  assertEquals(source.includes('id="signinRememberMe"'), true);
  assertEquals(source.includes('id="signupRememberMe"'), true);
  assertEquals(source.includes('data-on-click="showPasswordResetRequest"'), true);
  assertEquals(source.includes('data-on-click="resendVerificationEmail"'), true);
  assertEquals(source.includes('data-on-click="startEmailChange"'), true);
  assertEquals(source.includes("ACTIVE SESSIONS"), true);
  assertEquals(source.includes('data-on-click="revokeOtherSessions"'), true);
  assertEquals(source.includes('data-on-click="revokeSession"'), true);
});
