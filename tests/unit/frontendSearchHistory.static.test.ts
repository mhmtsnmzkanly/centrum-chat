import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the local message-search history contract:
// account-scoped localStorage persistence, individual + bulk removal,
// history panel wiring, and state reset on logout.

const html = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));
const handlersJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-handlers.js", import.meta.url),
);
const authJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-auth.js", import.meta.url),
);

Deno.test("search history is stored per account in local storage only", () => {
  assert(handlersJs.includes("`chat_search_history_${uId}`"));
  // History must never leave the client: no server request may carry it.
  assert(!handlersJs.includes('wsClient.request("search.history"'));
});

Deno.test("history is capped, deduplicated, and cleared entry-by-entry or fully", () => {
  assert(handlersJs.includes("SEARCH_HISTORY_LIMIT = 10"));
  assert(handlersJs.includes(".filter((q) => q !== trimmed)"));
  assert(handlersJs.includes("removeSearchHistoryEntry(e, el)"));
  assert(handlersJs.includes("clearSearchHistory()"));
  // Clearing everything removes the storage key instead of writing "[]".
  assert(handlersJs.includes("STORAGE.removeItem(key)"));
});

Deno.test("search bar renders the history panel with apply/remove/clear controls", () => {
  assert(html.includes('data-show="searchHistoryPanelVisible"'));
  assert(html.includes('data-on-click="applySearchHistoryEntry"'));
  assert(html.includes('data-on-click="removeSearchHistoryEntry"'));
  assert(html.includes('data-on-click="clearSearchHistory"'));
  assert(html.includes('data-on-keydown="handleSearchInputKeydown"'));
});

Deno.test("live search records history only after typing pauses", () => {
  assert(handlersJs.includes("searchHistoryRecordTimer = setTimeout("));
  assert(handlersJs.includes("recordSearchHistory(trimmed, originatingUserId)"));
});

Deno.test("logout resets in-memory search history and focus mode", () => {
  assert(authJs.includes('store.set("searchHistory", [])'));
  assert(authJs.includes('store.set("focusMode", false)'));
});
