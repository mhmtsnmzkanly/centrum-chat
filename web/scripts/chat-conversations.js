import { store } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { hideModal } from "./chat-dialogs.js";

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
  store.set("activeDest", { type, value });
  store.set("activeDestKey", `${type}_${value}`);
  store.set(`notifications.${type}_${value}`, 0);
  store.set("typingState.active", false);
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
