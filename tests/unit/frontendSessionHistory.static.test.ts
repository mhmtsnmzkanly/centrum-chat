import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the account-security session list UI: IP and
// client (user-agent) rows, a Revoked history badge, and no revoke action on
// already-revoked entries.

const html = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));
const handlersJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-handlers.js", import.meta.url),
);

Deno.test("session entries render IP, client summary, and a Revoked badge", () => {
  assert(html.includes("IP: ${sessionItem.ipDisplay}"));
  assert(html.includes("Client: ${sessionItem.clientDisplay}"));
  assert(html.includes('<if is-truthy="sessionItem.revoked">'));
});

Deno.test("revoke action is hidden for revoked history entries", () => {
  assert(html.includes('<if is-truthy="sessionItem.canRevoke">'));
  assert(handlersJs.includes("canRevoke: !s.revokedAt"));
});

Deno.test("missing metadata falls back to safe display text and long user-agents are truncated", () => {
  assert(handlersJs.includes('ipDisplay: s.ipAddress || "Unknown"'));
  assert(handlersJs.includes('"Unknown client"'));
  assert(handlersJs.includes("userAgent.slice(0, 90)"));
});
