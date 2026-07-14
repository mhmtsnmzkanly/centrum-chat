import { store } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { hideModal } from "./chat-dialogs.js";
import { STORAGE, registerAuthCleanup } from "./chat-auth.js";

export const STATUS_BADGES = {
  online: {
    dot: "#10B981",
    text: "Online",
    class: "status-badge-online",
    glow: "rgba(16, 185, 129, 0.4)",
  },
  idle: {
    dot: "#F59E0B",
    text: "Idle",
    class: "status-badge-idle",
    glow: "rgba(245, 158, 11, 0.4)",
  },
  dnd: {
    dot: "#EF4444",
    text: "Do Not Disturb",
    class: "status-badge-dnd",
    glow: "rgba(239, 68, 68, 0.4)",
  },
  offline: {
    dot: "#9CA3AF",
    text: "Offline",
    class: "status-badge-offline",
    glow: "rgba(156, 163, 175, 0)",
  },
};

// ── Per-conversation scroll position memory (session-only) ─────────
// Saved when leaving a conversation, applied after its messages re-render.
// Several candidate anchor ids are kept so a deleted anchor message falls
// back to the next still-existing one; the raw scrollTop is the last resort.
const NEAR_BOTTOM_PX = 100;
const scrollPositions = new Map();

export function isStreamNearBottom() {
  const stream = document.getElementById("messageStream");
  if (!stream) return true;
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight < NEAR_BOTTOM_PX;
}

export function saveScrollPosition(destKey) {
  const stream = document.getElementById("messageStream");
  if (!stream || !destKey) return;
  if (isStreamNearBottom()) {
    // At the bottom the default follow-latest behavior is what the user wants.
    scrollPositions.delete(destKey);
    return;
  }
  const streamTop = stream.getBoundingClientRect().top;
  const anchors = [];
  for (const el of stream.querySelectorAll(".message-group, .system-message-row")) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > streamTop) {
      anchors.push({ id: el.id, offset: rect.top - streamTop });
      if (anchors.length >= 3) break;
    }
  }
  scrollPositions.set(destKey, { anchors, scrollTop: stream.scrollTop });
}

/** Returns true when a saved position was applied (and consumed). */
export function restoreScrollPosition(destKey) {
  const saved = scrollPositions.get(destKey);
  if (!saved) return false;
  const stream = document.getElementById("messageStream");
  if (!stream) return false;
  scrollPositions.delete(destKey);
  const streamTop = stream.getBoundingClientRect().top;
  for (const anchor of saved.anchors) {
    const el = document.getElementById(anchor.id);
    if (!el) continue; // message deleted -> next candidate anchor
    stream.scrollTop += el.getBoundingClientRect().top - streamTop - anchor.offset;
    return true;
  }
  stream.scrollTop = Math.min(saved.scrollTop, stream.scrollHeight);
  return true;
}

export function hasSavedScrollPosition(destKey) {
  return scrollPositions.has(destKey);
}

// ── Per-conversation composer drafts (account-scoped, local-only) ──
function draftsStorageKey(userId) {
  const uId = userId || store.get("session.user")?.id;
  return uId ? `chat_drafts_${uId}` : null;
}

export function loadDrafts() {
  const user = store.get("session.user");
  if (!user) return;
  const key = draftsStorageKey(user.id);
  if (!key) return;
  try {
    const parsed = JSON.parse(STORAGE.getItem(key) || "{}");
    const drafts = {};
    if (parsed && typeof parsed === "object") {
      for (const [destKey, text] of Object.entries(parsed)) {
        if (typeof text === "string" && text.trim() !== "") drafts[destKey] = text;
      }
    }
    store.set("drafts", drafts);
  } catch {
    store.set("drafts", {});
  }
}

export function setDraft(destKey, text, userId) {
  if (!destKey || !userId) return;
  const currentUser = store.get("session.user");
  if (!currentUser || currentUser.id !== userId) return;
  if (!store.get("session.loggedIn")) return;

  const drafts = { ...(store.get("drafts") || {}) };
  if ((text || "").trim() === "") {
    if (!(destKey in drafts)) return;
    delete drafts[destKey];
  } else {
    drafts[destKey] = text;
  }
  store.set("drafts", drafts);
  const key = draftsStorageKey(userId);
  if (!key) return;
  if (Object.keys(drafts).length === 0) {
    STORAGE.removeItem(key);
  } else {
    STORAGE.setItem(key, JSON.stringify(drafts));
  }
}

let draftPersistTimer = null;

export function cancelPendingDraftPersistence() {
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
  }
}

registerAuthCleanup(cancelPendingDraftPersistence);

store.subscribe("chatForm.messageInput", (value) => {
  if (!store.get("session.loggedIn")) return;
  const user = store.get("session.user");
  if (!user) return;
  const originatingUserId = user.id;
  const destKey = store.get("activeDestKey");
  
  clearTimeout(draftPersistTimer);
  draftPersistTimer = null;
  
  if ((value || "").trim() === "") {
    setDraft(destKey, "", originatingUserId);
  } else {
    draftPersistTimer = setTimeout(() => {
      if (
        store.get("session.loggedIn") &&
        store.get("session.user")?.id === originatingUserId &&
        store.get("activeDestKey") === destKey
      ) {
        setDraft(destKey, value || "", originatingUserId);
      }
    }, 500);
  }
});

export function activeConversationId() {
  const dest = store.get("activeDest");
  if (!dest) return null;
  if (dest.type === "channel") {
    const chan = (store.get("channelList") || []).find((c) => c.slug === dest.value);
    return chan ? chan.id : null;
  }
  return dest.value;
}

export function setRoomMessages(destKey, msgs) {
  store.set("messages", { ...(store.get("messages") || {}), [destKey]: msgs });
}

export function appendRoomMessage(destKey, message) {
  const rooms = store.get("messages") || {};
  setRoomMessages(destKey, [...(rooms[destKey] || []), message]);
}

export function markConversationAsRead(conversationId) {
  const key = store.get("activeDestKey");
  const msgs = store.get(`messages.${key}`) || [];
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg) {
    wsClient.request("room.markRead", { conversationId, messageId: lastMsg.id }).catch(() => {});
  }
}

export function closeDestinationDropdown() {
  const selector = document.getElementById("channelDropdownSelector");
  if (selector) {
    const bsDropdown = window.bootstrap?.Dropdown?.getInstance(selector);
    if (bsDropdown) bsDropdown.hide();
  }
}

export function setActiveDestination(type, value) {
  const user = store.get("session.user");
  const nextKey = `${type}_${value}`;
  const prevKey = store.get("activeDestKey");
  if (prevKey && prevKey !== nextKey) {
    saveScrollPosition(prevKey);
    if (user) {
      setDraft(prevKey, store.get("chatForm.messageInput") || "", user.id);
    }
  }
  store.set("activeDest", { type, value });
  store.set("activeDestKey", nextKey);
  store.set(`notifications.${nextKey}`, 0);
  store.set("typingState.active", false);
  // The FAB counter belongs to one conversation; it never carries over.
  store.set("scrollFabCount", 0);
  if (prevKey !== nextKey) {
    store.set("chatForm.messageInput", store.get(`drafts.${nextKey}`) || "");
  }
}

// Shared: open (or create) the DM room with a user and switch to it
export async function openDmWithUser(userId, loadInitialData, loadConversationHistory) {
  const resolved = (store.get("resolvedDms") || []).find((d) => d.id === userId);
  let conversationId = resolved?.conversationId;

  if (!conversationId) {
    try {
      const result = await wsClient.request("dm.open", { userId });
      conversationId = result.room.id;
      await loadInitialData();
    } catch (err) {
      console.error("Failed to open DM:", err);
      return;
    }
  }

  setActiveDestination("dm", conversationId);
  await loadConversationHistory({ type: "dm", value: conversationId }, conversationId);
  markConversationAsRead(conversationId);
  hideModal("visitorProfileModal");
  hideModal("createGroupModal");
}
