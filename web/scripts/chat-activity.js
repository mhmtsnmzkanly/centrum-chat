import { store } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { registerAuthCleanup } from "./chat-auth.js";

const ACTIVITY_FILTER_TYPES = {
  all: null,
  unread: null,
  mentions: new Set(["mention", "reply"]),
  reactions: new Set(["reaction"]),
  invites: new Set(["group_invite"]),
};

const ACTIVITY_TYPE_META = {
  mention: {
    title: "Mention",
    description: "You were mentioned in a message.",
    icon: "bi-at",
  },
  reply: {
    title: "Reply",
    description: "Someone replied to your message.",
    icon: "bi-reply-fill",
  },
  dm: {
    title: "Direct message",
    description: "You received a new direct message.",
    icon: "bi-chat-dots-fill",
  },
  reaction: {
    title: "Reaction",
    description: "Someone reacted to your message.",
    icon: "bi-emoji-smile-fill",
  },
  group_invite: {
    title: "Group invitation",
    description: "You were added to a group conversation.",
    icon: "bi-people-fill",
  },
  system: {
    title: "System update",
    description: "There is an update from CentrumChat.",
    icon: "bi-info-circle-fill",
  },
  security: {
    title: "Security update",
    description: "There is an update about your account security.",
    icon: "bi-shield-lock-fill",
  },
};

let requestSequence = 0;

function currentAccountId() {
  return store.get("session.user")?.id || null;
}

function isCurrentRequest(sequence, accountId) {
  return sequence === requestSequence && accountId && currentAccountId() === accountId;
}

function normalizeNotification(notification) {
  if (!notification || typeof notification !== "object" || typeof notification.id !== "string") {
    return null;
  }
  return {
    id: notification.id,
    type: typeof notification.type === "string" ? notification.type : "unknown",
    conversationId: typeof notification.conversationId === "string"
      ? notification.conversationId
      : null,
    messageId: typeof notification.messageId === "string" ? notification.messageId : null,
    isRead: notification.isRead === true,
    createdAt: typeof notification.createdAt === "string" ? notification.createdAt : "",
  };
}

function sortNotifications(notifications) {
  return [...notifications].sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
}

function filteredNotifications() {
  const filter = store.get("activityInbox.filter") || "all";
  const notifications = store.get("activityInbox.notifications") || [];
  if (filter === "unread") return notifications.filter((notification) => !notification.isRead);
  const acceptedTypes = ACTIVITY_FILTER_TYPES[filter];
  return acceptedTypes
    ? notifications.filter((notification) => acceptedTypes.has(notification.type))
    : notifications;
}

function formatActivityTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function replaceNotifications(updater) {
  const current = store.get("activityInbox.notifications") || [];
  store.set("activityInbox.notifications", updater(current));
}

export function resetActivityInbox() {
  requestSequence += 1;
  store.set("activityInbox", {
    notifications: [],
    filter: "all",
    selectedIds: [],
    loading: false,
    actionPending: false,
    error: "",
  });
}

registerAuthCleanup(resetActivityInbox);

export async function refreshActivityInbox() {
  const accountId = currentAccountId();
  if (!accountId) return;
  const sequence = ++requestSequence;
  store.set("activityInbox.loading", true);
  store.set("activityInbox.error", "");
  try {
    const result = await wsClient.request("notification.list", {});
    if (!isCurrentRequest(sequence, accountId)) return;
    const notifications = Array.isArray(result.notifications)
      ? result.notifications.map(normalizeNotification).filter(Boolean)
      : [];
    store.set("activityInbox.notifications", sortNotifications(notifications));
    const availableIds = new Set(notifications.map((notification) => notification.id));
    store.set(
      "activityInbox.selectedIds",
      (store.get("activityInbox.selectedIds") || []).filter((id) => availableIds.has(id)),
    );
  } catch (error) {
    if (!isCurrentRequest(sequence, accountId)) return;
    console.error("Failed to load activity inbox:", error);
    store.set("activityInbox.error", "Activity could not be loaded. Please try again.");
  } finally {
    if (isCurrentRequest(sequence, accountId)) store.set("activityInbox.loading", false);
  }
}

export function addActivityNotification(rawNotification) {
  const notification = normalizeNotification(rawNotification);
  if (!notification || !currentAccountId()) return;
  replaceNotifications((notifications) => {
    const withoutDuplicate = notifications.filter((item) => item.id !== notification.id);
    return sortNotifications([notification, ...withoutDuplicate]);
  });
}

export function setActivityFilter(filter) {
  if (!Object.hasOwn(ACTIVITY_FILTER_TYPES, filter)) return;
  store.set("activityInbox.filter", filter);
  const visibleIds = new Set(filteredNotifications().map((notification) => notification.id));
  store.set(
    "activityInbox.selectedIds",
    (store.get("activityInbox.selectedIds") || []).filter((id) => visibleIds.has(id)),
  );
}

export function toggleActivitySelection(notificationId) {
  const notifications = store.get("activityInbox.notifications") || [];
  if (!notifications.some((notification) => notification.id === notificationId)) return;
  const selected = new Set(store.get("activityInbox.selectedIds") || []);
  if (selected.has(notificationId)) selected.delete(notificationId);
  else selected.add(notificationId);
  store.set("activityInbox.selectedIds", [...selected]);
}

export function toggleVisibleActivitySelection() {
  const visibleIds = filteredNotifications().map((notification) => notification.id);
  const selected = new Set(store.get("activityInbox.selectedIds") || []);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  for (const id of visibleIds) {
    if (allVisibleSelected) selected.delete(id);
    else selected.add(id);
  }
  store.set("activityInbox.selectedIds", [...selected]);
}

export async function markActivityRead(notificationId) {
  const notification = (store.get("activityInbox.notifications") || [])
    .find((item) => item.id === notificationId);
  if (!notification || notification.isRead || store.get("activityInbox.actionPending")) return;
  const accountId = currentAccountId();
  if (!accountId) return;
  try {
    await wsClient.request("notification.markRead", { notificationId });
    if (currentAccountId() !== accountId) return;
    replaceNotifications((notifications) => notifications.map((item) => (
      item.id === notificationId ? { ...item, isRead: true } : item
    )));
  } catch (error) {
    console.error("Failed to mark activity as read:", error);
  }
}

export async function markAllActivityRead() {
  if (store.get("activityInbox.actionPending")) return;
  const accountId = currentAccountId();
  if (!accountId) return;
  store.set("activityInbox.actionPending", true);
  try {
    await wsClient.request("notification.markRead", { all: true });
    if (currentAccountId() !== accountId) return;
    replaceNotifications((notifications) => notifications.map((item) => ({ ...item, isRead: true })));
  } catch (error) {
    console.error("Failed to mark all activity as read:", error);
  } finally {
    if (currentAccountId() === accountId) store.set("activityInbox.actionPending", false);
  }
}

export async function deleteSelectedActivity() {
  if (store.get("activityInbox.actionPending")) return null;
  const ids = [...new Set(store.get("activityInbox.selectedIds") || [])];
  const accountId = currentAccountId();
  if (!accountId || ids.length === 0) return null;
  store.set("activityInbox.actionPending", true);
  let deletedCount = 0;
  try {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const result = await wsClient.request("notification.delete", { ids: ids.slice(offset, offset + 100) });
      if (currentAccountId() !== accountId) return null;
      deletedCount += Number(result.deletedCount) || 0;
    }
    const deletedIds = new Set(ids);
    replaceNotifications((notifications) => notifications.filter((item) => !deletedIds.has(item.id)));
    store.set("activityInbox.selectedIds", []);
    return deletedCount;
  } catch (error) {
    console.error("Failed to delete selected activity:", error);
    await refreshActivityInbox();
    return null;
  } finally {
    if (currentAccountId() === accountId) store.set("activityInbox.actionPending", false);
  }
}

export async function deleteAllActivity() {
  if (store.get("activityInbox.actionPending")) return null;
  const accountId = currentAccountId();
  if (!accountId) return null;
  store.set("activityInbox.actionPending", true);
  try {
    const result = await wsClient.request("notification.delete", { all: true });
    if (currentAccountId() !== accountId) return null;
    store.set("activityInbox.notifications", []);
    store.set("activityInbox.selectedIds", []);
    return Number(result.deletedCount) || 0;
  } catch (error) {
    console.error("Failed to delete all activity:", error);
    return null;
  } finally {
    if (currentAccountId() === accountId) store.set("activityInbox.actionPending", false);
  }
}

export function activityById(notificationId) {
  return (store.get("activityInbox.notifications") || [])
    .find((notification) => notification.id === notificationId) || null;
}

export function activityItemsForView() {
  const selected = new Set(store.get("activityInbox.selectedIds") || []);
  return filteredNotifications().map((notification) => {
    const meta = ACTIVITY_TYPE_META[notification.type] || {
      title: "Activity update",
      description: "You have a new activity update.",
      icon: "bi-bell-fill",
    };
    const isSelected = selected.has(notification.id);
    return {
      ...notification,
      ...meta,
      timeLabel: formatActivityTime(notification.createdAt),
      rowClass: notification.isRead ? "is-read" : "is-unread",
      selectionClass: isSelected ? "is-selected" : "",
      selectionIcon: isSelected ? "bi-check-square-fill" : "bi-square",
      selectionAria: isSelected ? "true" : "false",
      selectionLabel: isSelected ? `Deselect ${meta.title}` : `Select ${meta.title}`,
      openLabel: notification.conversationId ? `Open ${meta.title}` : `Mark ${meta.title} as read`,
      actionText: notification.conversationId ? "Open" : "Mark read",
    };
  });
}

store.computed(
  "activityItems",
  ["activityInbox.notifications", "activityInbox.filter", "activityInbox.selectedIds"],
  activityItemsForView,
);

store.computed("activityHeaderBadge.text", ["activityInbox.notifications"], () => {
  const unread = (store.get("activityInbox.notifications") || [])
    .filter((item) => !item.isRead).length;
  return unread > 99 ? "99+" : String(unread);
});

store.computed("activityHeaderBadge.class", ["activityInbox.notifications"], () => {
  return (store.get("activityInbox.notifications") || []).some((item) => !item.isRead)
    ? ""
    : "d-none";
});

store.computed("activityInbox.hasItems", ["activityItems"], () => {
  return (store.get("activityItems") || []).length > 0;
});

store.computed("activityInbox.hasAny", ["activityInbox.notifications"], () => {
  return (store.get("activityInbox.notifications") || []).length > 0;
});

store.computed(
  "activityInbox.showEmpty",
  ["activityItems", "activityInbox.loading", "activityInbox.error"],
  () => {
    return !store.get("activityInbox.loading") && !store.get("activityInbox.error") &&
      (store.get("activityItems") || []).length === 0;
  },
);

store.computed("activityInbox.showLoading", ["activityInbox.loading", "activityInbox.hasAny"], () => {
  return store.get("activityInbox.loading") && !store.get("activityInbox.hasAny");
});

store.computed("activityInbox.hasError", ["activityInbox.error"], () => {
  return !!store.get("activityInbox.error");
});

store.computed("activityInbox.emptyText", ["activityInbox.filter"], () => {
  return store.get("activityInbox.filter") === "all"
    ? "Your activity inbox is empty."
    : "No activity matches this filter.";
});

store.computed("activityInbox.selectedText", ["activityInbox.selectedIds"], () => {
  const count = (store.get("activityInbox.selectedIds") || []).length;
  return count === 0 ? "No activity selected" : `${count} selected`;
});

store.computed("activityInbox.hasSelection", ["activityInbox.selectedIds"], () => {
  return (store.get("activityInbox.selectedIds") || []).length > 0;
});

store.computed("activityInbox.hasUnread", ["activityInbox.notifications"], () => {
  return (store.get("activityInbox.notifications") || []).some((item) => !item.isRead);
});

for (const filter of Object.keys(ACTIVITY_FILTER_TYPES)) {
  store.computed(
    `activityInbox.${filter}FilterClass`,
    ["activityInbox.filter"],
    () => store.get("activityInbox.filter") === filter ? "active" : "",
  );
}
