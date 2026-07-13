import { assertEquals } from "jsr:@std/assert@1";
import { canAddToGroup, canOpenDm } from "../../src/domain/conversations/privacyPolicy.ts";

Deno.test("canOpenDm: everyone allows regardless of shared groups", () => {
  assertEquals(canOpenDm("everyone", false), true);
  assertEquals(canOpenDm("everyone", true), true);
});

Deno.test("canOpenDm: group_members requires a shared group", () => {
  assertEquals(canOpenDm("group_members", true), true);
  assertEquals(canOpenDm("group_members", false), false);
});

Deno.test("canOpenDm: no_one always denies", () => {
  assertEquals(canOpenDm("no_one", true), false);
  assertEquals(canOpenDm("no_one", false), false);
});

Deno.test("canAddToGroup: everyone allows regardless of an existing DM", () => {
  assertEquals(canAddToGroup("everyone", false), true);
  assertEquals(canAddToGroup("everyone", true), true);
});

Deno.test("canAddToGroup: dm_contacts requires an existing DM", () => {
  assertEquals(canAddToGroup("dm_contacts", true), true);
  assertEquals(canAddToGroup("dm_contacts", false), false);
});

Deno.test("canAddToGroup: no_one always denies", () => {
  assertEquals(canAddToGroup("no_one", true), false);
  assertEquals(canAddToGroup("no_one", false), false);
});
