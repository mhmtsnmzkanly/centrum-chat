import { mount, setDevMode } from "./lime-csr.js";
import { store } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { TOKENS, STORAGE } from "./chat-auth.js";
import { ToastService } from "./chat-api.js";
import { HELPERS, MAPPERS, patchMessageById } from "./chat-messages.js";
import { playBeep, hideSplashLoader } from "./chat-dialogs.js";
import { activeConversationId, setRoomMessages, appendRoomMessage, setActiveDestination } from "./chat-conversations.js";
import { UploadOverlay, destKeyForConversation, setupDragDropZone } from "./chat-media.js";
import { refreshUserProfile } from "./chat-profile.js";
import { applySystemTheme } from "./shared-theme.js";
import {
  handlers,
  initApp,
  loadInitialData,
  openUserProfileById,
  ensureEmojiPickerMounted,
  showReactionUsersPopover,
  ChatService,
  ensureUsersKnown,
} from "./chat-handlers.js";

setDevMode(false);

// ── Global click listener to close emoji picker when clicking outside
document.addEventListener("click", (e) => {
  const popover = document.getElementById("emojiPopoverContainer");
  const toggleBtn = document.getElementById("emojiToggleBtn");
  if (popover && toggleBtn) {
    if (
      !popover.contains(e.target) &&
      !toggleBtn.contains(e.target) &&
      !e.target.closest('[data-on-click="showMsgReactionPicker"]')
    ) {
      popover.className = "emoji-picker-popover";
    }
  }
});

// Setup Dark/Light mode on boot
const savedDarkMode = STORAGE.getItem("chat_dark_mode");
if (savedDarkMode === "1") {
  document.body.classList.add("dark-mode");
} else {
  document.body.classList.remove("dark-mode");
}

// Scroll FAB handler
document.addEventListener("scroll", (e) => {
  const stream = document.getElementById("messageStream");
  const fab = document.getElementById("scrollBottomFab");
  if (!stream || !fab || e.target !== stream) return;

  const distFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  if (distFromBottom > 120) {
    fab.classList.remove("d-none");
  } else {
    fab.classList.add("d-none");
  }
}, true);

// Focus mode keyboard exit. Escape leaves focus mode, but never while a modal
// is open — Bootstrap owns Escape there and closing the modal must win.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!store.get("focusMode")) return;
  if (document.querySelector(".modal.show")) return;
  store.set("focusMode", false);
});

// Context menu reaction user list
document.addEventListener("contextmenu", (e) => {
  const badge = e.target.closest(".reaction-badge");
  if (badge) {
    e.preventDefault();
    const msgId = badge.getAttribute("data-msg-id");
    const emoji = badge.getAttribute("data-emoji");
    const msg = ChatService.getMessageById(msgId);
    if (msg && msg.reactions && msg.reactions[emoji]) {
      showReactionUsersPopover(badge, emoji, msg.reactions[emoji]);
    }
  }
});

// ── WebSocket push handlers ──────────────────────────────────────
wsClient.addEventListener("message.new", async (data) => {
  const mapped = MAPPERS.message(data.message);
  const activeDestKey = store.get("activeDestKey");
  const currentUser = store.get("session.user");
  const isOwn = !!(currentUser && mapped.authorId === currentUser.id);

  if (mapped.authorId && !isOwn) {
    await refreshUserProfile(mapped.authorId);
  }

  const msgDestKey = destKeyForConversation(mapped.conversationId);

  if (
    msgDestKey.startsWith("dm_") &&
    !(store.get("resolvedDms") || []).some((d) => d.conversationId === mapped.conversationId)
  ) {
    await loadInitialData();
  }

  appendRoomMessage(msgDestKey, mapped);

  if (activeDestKey === msgDestKey) {
    if (!isOwn) playBeep();
    wsClient.request("room.markRead", { conversationId: mapped.conversationId, messageId: mapped.id })
      .catch(() => {});
  } else if (!isOwn) {
    const countKey = `notifications.${msgDestKey}`;
    const prev = store.get(countKey) || 0;
    store.set(countKey, prev + 1);
    playBeep();
  }
});

wsClient.addEventListener("message.updated", (data) => {
  const mapped = MAPPERS.message(data.message);
  patchMessageById(mapped.id, mapped);
});

wsClient.addEventListener("reaction.updated", (data) => {
  const { messageId, reactions } = data;
  const mappedReactions = {};
  for (const r of reactions) {
    mappedReactions[r.emoji] = r.userIds || [];
  }

  ensureUsersKnown(Object.values(mappedReactions).flat());

  patchMessageById(messageId, { reactions: mappedReactions });
});

wsClient.addEventListener("presence.updated", (data) => {
  const { userId, status } = data;
  const existing = store.get(`users.${userId}`);
  if (existing) {
    store.set(`users.${userId}`, { ...existing, status });
  }

  const resolvedDms = [...(store.get("resolvedDms") || [])];
  const dmIdx = resolvedDms.findIndex((d) => d.id === userId);
  if (dmIdx !== -1) {
    resolvedDms[dmIdx] = { ...resolvedDms[dmIdx], status };
    store.set("resolvedDms", resolvedDms);
  }
});

wsClient.addEventListener("typing.updated", (data) => {
  const { conversationId, userId, isTyping } = data;
  const currentUser = store.get("session.user");
  if (currentUser && userId === currentUser.id) return;

  if (activeConversationId() !== conversationId) return;

  if (isTyping) {
    const user = store.get(`users.${userId}`);
    const displayName = user ? user.displayName : "Someone";
    store.set("typingState", {
      active: true,
      avatarUrl: user?.avatarUrl || HELPERS.dicebearUrl(userId),
      text: `${displayName} is typing`,
    });
  } else {
    store.set("typingState.active", false);
  }
});

wsClient.addEventListener("unread.updated", (data) => {
  const { conversationId, count } = data;
  const destKey = destKeyForConversation(conversationId);
  if (destKey === store.get("activeDestKey")) return;
  store.set(`notifications.${destKey}`, count);
});

wsClient.addEventListener("notification.new", (data) => {
  const { notification } = data;
  const labels = {
    mention: "You were mentioned in a message.",
    dm: "New direct message received.",
    group_invite: "You were added to a group.",
    reaction: "Someone reacted to your message.",
  };
  ToastService.show(labels[notification.type] || "New notification.", "info");
  if (notification.type === "group_invite") {
    loadInitialData();
  }
});

wsClient.addEventListener("room.updated", () => {
  loadInitialData();
});

// ── Live search wiring ───────────────────────────────────────────
store.subscribe("searchState.userQuery", async (query) => {
  const trimmed = (query || "").trim();
  if (trimmed === "") {
    store.set("searchState.searchResults", []);
    return;
  }
  try {
    const res = await wsClient.request("search.users", { query: trimmed });
    store.set("searchState.searchResults", res.users.map(MAPPERS.userSummary));
  } catch (err) {
    console.error("User search failed:", err);
  }
});

store.subscribe("searchState.messageQuery", async (query) => {
  const trimmed = (query || "").trim();
  if (trimmed === "") {
    store.set("searchState.searchResultsMessages", null);
    return;
  }
  const conversationId = activeConversationId();
  if (!conversationId) return;
  try {
    const res = await wsClient.request("search.messages", { conversationId, query: trimmed });
    const messages = res.messages.map(MAPPERS.message);
    await ensureUsersKnown(messages.map((m) => m.authorId));
    store.set("searchState.searchResultsMessages", messages);
  } catch (err) {
    console.error("Message search failed:", err);
  }
});

// ── Bootstrap Modal triggers / accessibility details ─────────────
document.addEventListener("click", (e) => {
  const dismiss = e.target instanceof Element && e.target.closest('[data-bs-dismiss="modal"]');
  if (!dismiss) return;
  const modal = dismiss.closest(".modal");
  if (!modal) return;
  setTimeout(() => {
    if (modal.classList.contains("show")) {
      window.bootstrap?.Modal?.getOrCreateInstance(modal)?.hide();
    }
  }, 450);
});

document.addEventListener("hide.bs.modal", (event) => {
  const modal = event.target;
  const activeElement = document.activeElement;
  if (
    modal instanceof HTMLElement && activeElement instanceof HTMLElement &&
    modal.contains(activeElement)
  ) {
    activeElement.blur();
  }
});

document.addEventListener("shown.bs.modal", (e) => {
  if (e.target.id === "uploadAttachmentModal") {
    setupDragDropZone(handlers);
  }
});

// Reload lists/history after reconnect
wsClient.onReconnect = () => {
  if (store.get("session.loggedIn")) {
    loadInitialData();
  }
};

// Mount the app template
const appRoot = document.getElementById("app");
if (appRoot) {
  mount("app", {}, appRoot, store, { handlers });
}

globalThis.__centrum = { store, wsClient };

initApp();
