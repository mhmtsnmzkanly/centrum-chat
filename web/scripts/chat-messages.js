import { store, CONFIG } from "./chat-store.js";
import { TOKENS } from "./chat-auth.js";
import { wsClient } from "./chat-socket.js";
import { ToastService } from "./chat-api.js";
import { playBeep } from "./chat-dialogs.js";

export const HELPERS = {
  sanitize: (str) => {
    const temp = document.createElement("div");
    temp.textContent = str;
    return temp.innerHTML;
  },
  dicebearUrl: (seed) =>
    `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(seed || "centrum")}`,
  formatJoined: (isoStr) => {
    const d = new Date(isoStr);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  },
  formatBytes: (bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  },
  getRelativeLuminance: (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b].map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  },
  getContrastRatio: (hex1, hex2) => {
    const rgb1 = HELPERS.getRelativeLuminance(hex1);
    const rgb2 = HELPERS.getRelativeLuminance(hex2);
    const l1 = 0.2126 * rgb1[0] + 0.7152 * rgb1[1] + 0.0722 * rgb1[2];
    const l2 = 0.2126 * rgb2[0] + 0.7152 * rgb2[1] + 0.0722 * rgb2[2];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  },
};

export const MAPPERS = {
  userSummary: (u) => {
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatarSeed: u.avatarSeed || "",
      avatarUrl: u.avatarUrl || HELPERS.dicebearUrl(u.avatarSeed || u.username),
      nameColor: u.nameColor || "#0284c7",
      status: u.status || "offline",
    };
  },

  profile: (p) => {
    if (!p) return null;
    return {
      ...MAPPERS.userSummary(p),
      bio: p.bio || CONFIG.defaultBio,
      joinedDate: HELPERS.formatJoined(p.joinedDate),
      isPremium: !!p.isPremium,
      messagesSent: p.messagesSent || 0,
      reactionsAdded: p.reactionsAdded || 0,
      repliesMade: p.repliesMade || 0,
      coverIndex: p.coverIndex || 0,
      coverUrl: p.coverUrl || null,
      isOperator: !!p.isOperator,
    };
  },

  conversation: (r) => {
    if (!r) return null;
    return {
      id: r.id,
      type: r.type,
      slug: r.slug || "",
      name: r.name || "",
      topic: r.topic || "",
      ownerId: r.ownerId || "",
      memberCount: r.memberCount || 0,
      createdAt: r.createdAt || "",
    };
  },

  message: (m) => {
    if (!m) return null;
    const reactions = {};
    if (m.reactions) {
      for (const r of m.reactions) {
        reactions[r.emoji] = r.userIds || [];
      }
    }

    return {
      id: m.id,
      conversationId: m.conversationId,
      authorId: m.authorId || null,
      content: m.content,
      timestamp: m.createdAt
        ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "",
      isoTimestamp: m.createdAt || "",
      reactions,
      replyTo: m.replyToId || null,
      attachment: m.attachments && m.attachments.length > 0
        ? {
          name: m.attachments[0].fileName,
          size: m.attachments[0].sizeBytes,
          type: m.attachments[0].mimeType,
          url: m.attachments[0].url,
        }
        : null,
      system: !!m.isSystem,
      edited: !!m.edited,
      deletedAt: m.deletedAt || null,
    };
  },

  preferences: (p) => {
    if (!p) {
      return {
        sound: true,
        desktopNotif: false,
        dmPrivacy: "everyone",
        groupPrivacy: "everyone",
        theme: "light",
      };
    }
    return {
      sound: p.sound !== false,
      desktopNotif: !!p.desktopNotifications,
      dmPrivacy: p.dmPrivacy || "everyone",
      groupPrivacy: p.groupPrivacy || "everyone",
      theme: p.theme || "light",
    };
  },
};

export function decorateMessage(msg, { currentUser, usersMap, messagesById, activeGroup }) {
  const author = (msg.authorId && usersMap[msg.authorId]) || {};
  const isOutgoing = !!(currentUser && msg.authorId === currentUser.id);

  let sizeFormatted = "";
  let fileIconClass = "bi-file-earmark";
  const attachment = msg.attachment ? { ...msg.attachment } : null;
  if (attachment) {
    const tokens = TOKENS.get();
    if (tokens?.accessToken && attachment.url && attachment.url.startsWith("/media/")) {
      attachment.url = `${attachment.url}?token=${encodeURIComponent(tokens.accessToken)}`;
    }
    sizeFormatted = HELPERS.formatBytes(attachment.size);
    const type = attachment.type || "";
    if (type.startsWith("image/")) {
      attachment.isImage = true;
    } else {
      attachment.isImage = false;
      if (type.includes("pdf")) fileIconClass = "bi-file-earmark-pdf text-danger";
      else if (type.includes("word") || type.includes("doc")) {
        fileIconClass = "bi-file-earmark-word text-primary";
      } else if (type.includes("sheet") || type.includes("excel") || type.includes("csv")) {
        fileIconClass = "bi-file-earmark-excel text-success";
      } else if (type.includes("zip") || type.includes("rar") || type.includes("archive")) {
        fileIconClass = "bi-file-earmark-zip text-warning";
      } else if (type.includes("audio")) fileIconClass = "bi-file-earmark-music text-info";
      else if (type.includes("video")) fileIconClass = "bi-file-earmark-play text-danger";
      else if (type.includes("text")) fileIconClass = "bi-file-earmark-text text-muted";
    }
  }

  const reactionBadges = Object.entries(msg.reactions || {}).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    activeClass: (currentUser && userIds.includes(currentUser.id)) ? "user-reacted" : "",
  }));

  const parentMsg = msg.replyTo ? messagesById.get(msg.replyTo) : null;
  const parentAuthor = parentMsg && parentMsg.authorId ? usersMap[parentMsg.authorId] : null;

  return {
    ...msg,
    isNormal: true,
    isOutgoing,
    groupClass: isOutgoing ? "outgoing" : "incoming",
    displayName: author.displayName || "Unknown",
    userColor: author.nameColor || "var(--text-dark)",
    isPremium: !!author.isPremium,
    isGroupOwner: !!(activeGroup && activeGroup.ownerId === msg.authorId),

    hasAttachment: !!attachment,
    attachment: attachment ? { ...attachment, fileIconClass, sizeFormatted } : null,
    attachmentUrl: attachment ? attachment.url : "",
    attachmentName: attachment ? attachment.name : "",
    attachmentSizeFormatted: attachment ? sizeFormatted : "",
    attachmentIsImage: attachment ? attachment.isImage : false,
    attachmentFileIconClass: attachment ? fileIconClass : "",

    replyToUser: parentMsg ? (parentAuthor?.displayName || "Unknown") : "",
    replyToText: parentMsg ? parentMsg.content : "",

    hasReactions: reactionBadges.length > 0,
    reactionBadges,
  };
}

export function patchMessageById(messageId, patch) {
  const rooms = store.get("messages") || {};
  for (const [key, msgs] of Object.entries(rooms)) {
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;
    const next = [...msgs];
    next[idx] = { ...msgs[idx], ...patch };
    store.set("messages", { ...rooms, [key]: next });
    return;
  }
}

store.computed("activeMessages", [
  "activeDestKey",
  "messages",
  "searchState.messageQuery",
  "searchState.searchResultsMessages",
  "users",
  "groupList",
  "session.user",
], () => {
  const destKey = store.get("activeDestKey");
  const query = (store.get("searchState.messageQuery") || "").trim();
  let msgs = store.get(`messages.${destKey}`) || [];

  if (query) {
    msgs = store.get("searchState.searchResultsMessages") || [];
  }

  msgs = msgs.filter((m) => !m.deletedAt);

  const decorated = [];
  let lastDateLabel = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const formatDateSep = (isoStr) => {
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    const msgDayMs = new Date(d).setHours(0, 0, 0, 0);
    if (msgDayMs === today.getTime()) return "Today";
    if (msgDayMs === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  const activeDest = store.get("activeDest");
  const decorateContext = {
    currentUser: store.get("session.user"),
    usersMap: store.get("users") || {},
    messagesById: new Map(msgs.map((m) => [m.id, m])),
    activeGroup: activeDest.type === "group"
      ? (store.get("groupList") || []).find((g) => g.id === activeDest.value)
      : null,
  };

  for (const msg of msgs) {
    const dateLabel = msg.isoTimestamp ? formatDateSep(msg.isoTimestamp) : null;
    if (dateLabel && dateLabel !== lastDateLabel && !query) {
      lastDateLabel = dateLabel;
      decorated.push({
        id: `sep_${msg.id}`,
        dateSeparator: true,
        content: dateLabel,
        reactionBadges: [],
      });
    }

    if (msg.system) {
      decorated.push({
        id: msg.id,
        system: true,
        content: msg.content,
        reactionBadges: [],
      });
    } else {
      decorated.push(decorateMessage(msg, decorateContext));
    }
  }

  return decorated;
});

store.subscribe("activeMessages", (newMsgs, oldMsgs) => {
  setTimeout(() => {
    const stream = document.getElementById("messageStream");
    if (!stream || !newMsgs) return;

    const lastMsg = newMsgs[newMsgs.length - 1];
    const isOwn = lastMsg && lastMsg.isOutgoing;
    const wasAtBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;

    if (wasAtBottom || isOwn || (oldMsgs && oldMsgs.length === 0)) {
      stream.scrollTop = stream.scrollHeight;
    }
  }, 50);
});

store.subscribe("lightbox.imgSrc", (url) => {
  const img = document.getElementById("lightboxImg");
  if (img) img.setAttribute("src", url || "");
});

store.subscribe("session.user.status", async (newStatus) => {
  const currentUser = store.get("session.user");
  if (!currentUser || !newStatus) return;
  if (currentUser.lastSyncedStatus === newStatus) return;
  try {
    await wsClient.request("presence.update", { status: newStatus });
    store.set("session.user", {
      ...currentUser,
      status: newStatus,
      lastSyncedStatus: newStatus,
    });
    store.set(`users.${currentUser.id}`, { ...store.get(`users.${currentUser.id}`), status: newStatus });
    ToastService.show(`Status updated to: ${newStatus.toUpperCase()}`, "success");
  } catch (err) {
    console.error("Presence status update failed:", err);
  }
});

store.subscribe("session.user", (user) => {
  if (user && user.id) {
    store.set(`users.${user.id}`, { ...user });
  }
});
