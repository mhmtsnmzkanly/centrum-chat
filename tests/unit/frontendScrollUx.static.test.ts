import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the scroll UX contract: the scroll-to-bottom
// FAB counts new messages arriving below the viewport, and per-conversation
// scroll positions are remembered with anchor-message fallback.

const html = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));
const storeJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-store.js", import.meta.url),
);
const conversationsJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-conversations.js", import.meta.url),
);
const messagesJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-messages.js", import.meta.url),
);
const chatJs = await Deno.readTextFile(new URL("../../web/scripts/chat.js", import.meta.url));
const css = await Deno.readTextFile(new URL("../../web/styles/chat.css", import.meta.url));

Deno.test("scroll FAB badge is store-driven with a 99+ cap", () => {
  assert(html.includes('data-fabbadgeclass="scrollFabBadgeClass"'));
  assert(html.includes('data-text="scrollFabBadgeText"'));
  assert(storeJs.includes('store.computed("scrollFabBadgeText", ["scrollFabCount"]'));
  assert(storeJs.includes('count > 99 ? "99+"'));
  assert(css.includes(".scroll-fab-badge"));
});

Deno.test("counter increments only for foreign messages below the viewport in the active conversation", () => {
  assert(chatJs.includes("const wasNearBottom = isStreamNearBottom();"));
  assert(chatJs.includes("if (!wasNearBottom) {"));
  assert(chatJs.includes('store.set("scrollFabCount", (store.get("scrollFabCount") || 0) + 1)'));
});

Deno.test("a positive counter surfaces the FAB even without a scroll event", () => {
  assert(chatJs.includes('store.subscribe("scrollFabCount", (count) => {'));
  assert(chatJs.includes('if (fab && count > 0) fab.classList.remove("d-none");'));
});

Deno.test("counter resets on FAB click, on reaching the bottom, and on conversation switch", () => {
  const handlersJs = Deno.readTextFileSync(
    new URL("../../web/scripts/chat-handlers.js", import.meta.url),
  );
  assert(handlersJs.includes('store.set("scrollFabCount", 0)')); // scrollToBottom
  assert(chatJs.includes('if (store.get("scrollFabCount")) store.set("scrollFabCount", 0)'));
  assert(conversationsJs.includes('store.set("scrollFabCount", 0)')); // setActiveDestination
});

Deno.test("scroll positions are saved with candidate anchors and restored with fallback", () => {
  assert(conversationsJs.includes("export function saveScrollPosition(destKey)"));
  assert(conversationsJs.includes("export function restoreScrollPosition(destKey)"));
  // Multiple anchor candidates so a deleted anchor falls back to the next message.
  assert(conversationsJs.includes("if (anchors.length >= 3) break;"));
  // Last-resort fallback clamps the raw scroll offset.
  assert(conversationsJs.includes("Math.min(saved.scrollTop, stream.scrollHeight)"));
  // Being at the bottom keeps the default follow-latest behavior.
  assert(conversationsJs.includes("scrollPositions.delete(destKey);"));
});

Deno.test("message re-render prefers a remembered position over follow-latest", () => {
  assert(messagesJs.includes("hasSavedScrollPosition(destKey) && restoreScrollPosition(destKey)"));
});

Deno.test("own-message jump requires the list to have grown, so decorative recomputes don't hijack scroll", () => {
  assert(messagesJs.includes("const grew = !oldMsgs || newMsgs.length > oldMsgs.length;"));
  assert(messagesJs.includes("lastMsg.isOutgoing && grew"));
});
