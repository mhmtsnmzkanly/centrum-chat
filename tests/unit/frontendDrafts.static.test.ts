import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the composer-draft contract: account-scoped
// local persistence keyed by conversation, save/restore on switch, debounce
// while typing, and full reset on logout.

const conversationsJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-conversations.js", import.meta.url),
);
const handlersJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-handlers.js", import.meta.url),
);
const authJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-auth.js", import.meta.url),
);
const chatJs = await Deno.readTextFile(new URL("../../web/scripts/chat.js", import.meta.url));

Deno.test("drafts are stored per account and per conversation, locally only", () => {
  assert(conversationsJs.includes("`chat_drafts_${user.id}`"));
  assert(conversationsJs.includes("export function setDraft(destKey, text)"));
  // Empty drafts are removed instead of stored, and an empty map drops the key.
  assert(conversationsJs.includes("delete drafts[destKey];"));
  assert(conversationsJs.includes("STORAGE.removeItem(key);"));
});

Deno.test("conversation switch saves the old draft and restores the new one", () => {
  assert(conversationsJs.includes('setDraft(prevKey, store.get("chatForm.messageInput") || "")'));
  assert(
    conversationsJs.includes(
      'store.set("chatForm.messageInput", store.get(`drafts.${nextKey}`) || "")',
    ),
  );
});

Deno.test("typing persists the draft after a debounce, guarded against mid-switch races", () => {
  assert(chatJs.includes("draftPersistTimer = setTimeout("));
  assert(chatJs.includes('if (store.get("activeDestKey") === destKey)'));
});

Deno.test("login loads drafts and seeds the composer; logout clears them", () => {
  assert(handlersJs.includes("loadDrafts();"));
  assert(authJs.includes('store.set("drafts", {})'));
  assert(authJs.includes('store.set("chatForm.messageInput", "")'));
});
