import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the chat focus-mode contract: a toggle in the
// header, a visible exit control, Escape-to-exit that yields to open modals,
// and CSS that hides the header + secondary panels while focus mode is active.

const html = await Deno.readTextFile(new URL("../../web/index.html", import.meta.url));
const storeJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-store.js", import.meta.url),
);
const handlersJs = await Deno.readTextFile(
  new URL("../../web/scripts/chat-handlers.js", import.meta.url),
);
const chatJs = await Deno.readTextFile(new URL("../../web/scripts/chat.js", import.meta.url));
const css = await Deno.readTextFile(new URL("../../web/styles/chat.css", import.meta.url));

Deno.test("chat card binds the focus-mode class from the store", () => {
  assert(html.includes('data-focusclass="focusModeClass"'));
  assert(storeJs.includes('store.computed("focusModeClass", ["focusMode"]'));
});

Deno.test("header exposes a focus-mode toggle and the card a visible exit control", () => {
  assert(html.includes('data-on-click="toggleFocusMode"'));
  assert(html.includes('data-show="focusMode"'));
  assert(html.includes('aria-label="Exit focus mode"'));
  assert(handlersJs.includes("toggleFocusMode()"));
});

Deno.test("Escape exits focus mode but defers to open modals", () => {
  assert(chatJs.includes('if (e.key !== "Escape") return;'));
  assert(chatJs.includes('if (!store.get("focusMode")) return;'));
  assert(chatJs.includes('if (document.querySelector(".modal.show")) return;'));
});

Deno.test("focus mode hides the chat header and search bar via CSS", () => {
  assert(css.includes(".glass-card.focus-mode .chat-header"));
  assert(css.includes(".glass-card.focus-mode .search-bar-container"));
  assert(css.includes(".focus-exit-btn"));
});
