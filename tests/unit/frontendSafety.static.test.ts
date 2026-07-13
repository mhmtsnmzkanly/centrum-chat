import { assertEquals } from "jsr:@std/assert@1";

Deno.test("normal chat exposes only normal-user safety and CAPTCHA integrations", async () => {
  const js = await Deno.readTextFile(new URL("../../web/index.js", import.meta.url));
  const html = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));
  assertEquals(js.includes("/api/safety/blocks/"), true);
  assertEquals(js.includes("/api/safety/reports"), true);
  assertEquals(js.includes("/api/moderation/"), false);
  assertEquals(js.includes("/api/admin/"), false);
  assertEquals(js.includes("CAPTCHA_SECRET_KEY"), false);
  assertEquals(js.includes('CAPTCHA.consume("register")'), true);
  assertEquals(js.includes('CAPTCHA.consume("login")'), true);
  assertEquals(js.includes('CAPTCHA.consume("password_reset")'), true);
  assertEquals(html.includes('data-on-click="reportMessage"'), true);
  assertEquals(html.includes('data-on-click="reportAttachment"'), true);
  assertEquals(html.includes('data-on-click="toggleBlockFromProfile"'), true);
  assertEquals(html.includes("admin-dashboard"), false);
});
