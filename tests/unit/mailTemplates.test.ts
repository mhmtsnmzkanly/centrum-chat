import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  renderEmailChangedNotice,
  renderEmailChangeVerificationMail,
  renderPasswordChangedNotice,
  renderPasswordResetMail,
  renderVerificationMail,
} from "../../src/application/mail/templates/accountSecurityMailTemplates.ts";

const actionUrl = "https://chat.example.test/auth?token=example-token";

function assertSafeTemplate(html: string, text: string): void {
  assertEquals(html.includes("<script"), false);
  assertEquals(html.includes("<form"), false);
  assertEquals(html.includes("@font-face"), false);
  assertEquals(html.includes("CentrumChat"), true);
  assertEquals(text.trim().length > 0, true);
}

Deno.test("account-security templates render branded HTML and plain-text alternatives", () => {
  const templates = [
    renderVerificationMail({
      toEmail: "alice@example.test",
      displayName: "Alice",
      verificationUrl: actionUrl,
    }),
    renderPasswordResetMail({
      toEmail: "alice@example.test",
      displayName: "Alice",
      resetUrl: actionUrl,
    }),
    renderPasswordChangedNotice({ toEmail: "alice@example.test", displayName: "Alice" }),
    renderEmailChangeVerificationMail({
      toEmail: "alice@example.test",
      displayName: "Alice",
      verificationUrl: actionUrl,
    }),
    renderEmailChangedNotice({
      toEmail: "alice@example.test",
      displayName: "Alice",
      newEmail: "new@example.test",
    }),
  ];

  for (const template of templates) {
    assertSafeTemplate(template.html, template.text);
    assertEquals(template.html.includes("display:none"), true);
    assertEquals(template.html.includes("chat.novastrum.dev"), true);
  }
  assertEquals(templates[0]!.subject, "Verify your CentrumChat email");
  assertEquals(templates[0]!.html.includes(">Verify email<"), true);
  assertEquals(templates[1]!.text.includes(actionUrl), true);
  assertEquals(templates[2]!.html.includes('bgcolor="#0284c7"'), false);
  assertEquals(templates[3]!.html.includes(">Confirm new email<"), true);
  assertEquals(templates[4]!.html.includes("new@example.test"), true);
});

Deno.test("account-security templates escape HTML injection in names and email addresses", () => {
  const name = '<img src=x onerror="alert(1)">';
  const email = "<b>new@example.test</b>";
  const verification = renderVerificationMail({
    toEmail: "alice@example.test",
    displayName: name,
    verificationUrl: actionUrl,
  });
  const changed = renderEmailChangedNotice({
    toEmail: "alice@example.test",
    displayName: name,
    newEmail: email,
  });

  assertEquals(verification.html.includes(name), false);
  assertEquals(verification.html.includes("&lt;img"), true);
  assertEquals(changed.html.includes(email), false);
  assertEquals(changed.html.includes("&lt;b&gt;new@example.test&lt;/b&gt;"), true);
});

Deno.test("account-security templates reject malformed and non-HTTP action URLs", () => {
  assertThrows(
    () =>
      renderVerificationMail({
        toEmail: "alice@example.test",
        displayName: "Alice",
        verificationUrl: "javascript:alert(1)",
      }),
    Error,
    "Mail action URL must use HTTP or HTTPS.",
  );
  assertThrows(
    () =>
      renderPasswordResetMail({
        toEmail: "alice@example.test",
        displayName: "Alice",
        resetUrl: "not a URL",
      }),
    Error,
    "Mail action URL must be an absolute HTTP(S) URL.",
  );
});
