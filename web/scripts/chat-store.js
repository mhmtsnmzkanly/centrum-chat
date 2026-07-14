import { createStore } from "./lime-csr.js";

// Configuration (avatar seeds + cover gradients ported from the original UI)
export const CONFIG = {
  defaultBio: "Hello, I am new to CentrumChat workspace!",
  avatarSeeds: ["Felix", "Max", "Luna", "Cleo", "Oliver", "Milo", "Leo", "Lucy"],
  coverGradients: [
    "linear-gradient(135deg, #0284c7, #8e44ad)",
    "linear-gradient(135deg, #1abc9c, #2ecc71)",
    "linear-gradient(135deg, #e74c3c, #f1c40f)",
    "linear-gradient(135deg, #34495e, #2c3e50)",
    "linear-gradient(135deg, #d35400, #c0392b)",
    "linear-gradient(135deg, #00c6ff, #0072ff)",
  ],
};

export const store = createStore({
  session: {
    loggedIn: false,
    user: null,
    isEditingProfile: false,
    profileDraft: {
      displayName: "",
      bio: "",
    },
    messageToDeleteId: null,
  },
  accountSecurity: {
    email: "",
    emailVerifiedAt: null,
    pendingEmail: null,
    isVerified: false,
  },
  sessionList: [],
  authState: {
    activeTab: "signin",
    signinEmail: "",
    signinPassword: "",
    signinRememberMe: false,
    signupUsername: "",
    signupEmail: "",
    signupPassword: "",
    signupRememberMe: false,
    resetMode: false,
    resetToken: "",
    resetEmail: "",
    resetNewPassword: "",
    resetConfirmPassword: "",
    pendingEmailChangeToken: "",
    signinClass: "active",
    signupClass: "",
  },
  searchState: {
    activeTab: "channels",
    userQuery: "",
    groupQuery: "",
    messageQuery: "",
    searchOpen: false,
    searchResults: [],
    searchResultsMessages: null,
  },
  // Recent message-search queries (newest first). Loaded per account from
  // localStorage after login; never sent to the server.
  searchHistory: [],
  // Unsent composer drafts keyed by destKey. Loaded per account from
  // localStorage after login; never sent to the server.
  drafts: {},
  // New messages that arrived in the active conversation while the user was
  // scrolled away from the bottom. Shown on the scroll-to-bottom FAB badge.
  scrollFabCount: 0,
  activeDest: { type: "channel", value: "general" },
  activeDestKey: "channel_general",
  notifications: {},
  // Keyed by user id (message authors, DM partners, self).
  users: {},
  groupList: [],
  channelList: [],
  resolvedDms: [],
  messages: {},
  prefs: {
    sound: true,
    desktopNotif: false,
    dmPrivacy: "everyone",
    groupPrivacy: "everyone",
    theme: window.localStorage.getItem("chat_dark_mode") === "1" ? "dark" : "light",
  },

  chatForm: {
    messageInput: "",
    attachedFileId: null,
    attachedFileDetails: null,
  },
  replyTarget: null,

  typingState: {
    active: false,
    avatarUrl: "",
    text: "",
  },
  lightbox: {
    open: false,
    imgSrc: "",
  },
  // Focus mode temporarily hides the header and secondary panels so only the
  // message stream and composer remain. Never persisted: it is a transient view state.
  focusMode: false,
  preferencesForm: {
    activeTab: "appearance",
    theme: "light",
    nameColor: "#0284c7",
    isPremium: false,
    sound: true,
    desktopNotif: false,
    dmPrivacy: "everyone",
    groupPrivacy: "everyone",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    newEmail: "",
  },
  visitorProfile: {
    id: "",
    username: "",
    displayName: "",
    bio: "",
    avatarUrl: "",
    statusColor: "",
    statusGlow: "",
    statusBadgeClass: "",
    statusText: "",
    joinedDate: "",
    messagesSent: 0,
    reactionsAdded: 0,
    repliesMade: 0,
    isPremium: false,
    mutualGroups: [],
    mutualGroupsCount: 0,
    coverStyle: "",
    nameColor: "",
    isSelf: false,
    handleDisplay: "",
  },
  createGroupForm: {
    name: "",
    candidateUsers: [],
    selectedUserIds: [],
  },
  groupMembersForm: {
    members: [],
    canAddMembers: false,
    addableUsers: [],
  },
  profileImagesForm: {
    avatarFile: null,
    coverFile: null,
  },
});

export function coverStyleFor(coverUrl, coverIndex) {
  if (coverUrl) return `url('${coverUrl}') center/cover no-repeat`;
  const gradients = CONFIG.coverGradients;
  return gradients[(coverIndex || 0) % gradients.length];
}

// Factory for the many one-liner computeds that just compare a store value
// ("is this tab active?") and yield a class string or boolean.
function computedMatch(target, dep, value, whenTrue, whenFalse = "") {
  store.computed(target, [dep], () => store.get(dep) === value ? whenTrue : whenFalse);
}

// Factory for background-image styles derived from an avatar url.
function computedAvatarStyle(target, dep) {
  store.computed(target, [dep], () => {
    const url = store.get(dep);
    return url ? `url('${url}') center/cover no-repeat` : "";
  });
}

store.computed("activeDestLabel", ["activeDest", "groupList", "resolvedDms"], () => {
  const dest = store.get("activeDest");
  if (!dest) return "";
  if (dest.type === "channel") return `# ${dest.value}`;
  if (dest.type === "dm") {
    const resolvedDms = store.get("resolvedDms") || [];
    const activeDm = resolvedDms.find((d) => d.conversationId === dest.value);
    return activeDm ? `@ ${activeDm.displayName}` : "Direct Message";
  }
  if (dest.type === "group") {
    const groups = store.get("groupList") || [];
    const g = groups.find((x) => x.id === dest.value);
    return g ? `~ ${g.name}` : "Group";
  }
  return "";
});

store.computed("channels", ["activeDest", "notifications", "channelList"], () => {
  const activeDest = store.get("activeDest");
  const chans = store.get("channelList") || [];
  return chans.map((c) => ({
    slug: c.slug,
    activeClass: (activeDest.type === "channel" && activeDest.value === c.slug) ? "active" : "",
    notifCount: store.get(`notifications.channel_${c.slug}`) || 0,
  }));
});

store.computed(
  "dms",
  [
    "resolvedDms",
    "activeDest",
    "notifications",
    "searchState.userQuery",
    "searchState.searchResults",
    "session.user",
  ],
  () => {
    const activeDest = store.get("activeDest");
    const resolvedDms = store.get("resolvedDms") || [];
    const query = (store.get("searchState.userQuery") || "").trim();
    const currentUser = store.get("session.user");

    const list = query ? (store.get("searchState.searchResults") || []) : resolvedDms;
    const dmByUserId = new Map(resolvedDms.map((d) => [d.id, d]));

    return list
      .filter((u) => !currentUser || u.id !== currentUser.id)
      .map((u) => {
        const conversationId = u.conversationId || dmByUserId.get(u.id)?.conversationId || null;
        return {
          ...u,
          conversationId,
          activeClass: (activeDest.type === "dm" && conversationId && activeDest.value === conversationId)
            ? "active"
            : "",
          notifCount: conversationId ? (store.get(`notifications.dm_${conversationId}`) || 0) : 0,
        };
      });
  },
);

store.computed(
  "groups",
  ["groupList", "activeDest", "notifications", "searchState.groupQuery"],
  () => {
    const activeDest = store.get("activeDest");
    const allGroups = store.get("groupList") || [];
    const query = (store.get("searchState.groupQuery") || "").trim().toLowerCase();

    return allGroups
      .filter((g) => !query || g.name.toLowerCase().includes(query))
      .map((g) => ({
        ...g,
        activeClass: (activeDest.type === "group" && activeDest.value === g.id) ? "active" : "",
        notifCount: store.get(`notifications.group_${g.id}`) || 0,
      }));
  },
);

store.computed("session.user.statusClass", ["session.user.status"], () => {
  return store.get("session.user.status") || "offline";
});

store.computed("session.user.usernameDisplay", ["session.user.username"], () => {
  const username = store.get("session.user.username");
  return username ? `@${username}` : "";
});

store.computed("session.user.handleDisplay", ["session.user.username"], () => {
  const username = store.get("session.user.username");
  return username ? `@${username}` : "";
});

store.computed(
  "session.user.coverStyle",
  ["session.user.coverUrl", "session.user.coverIndex"],
  () => {
    return coverStyleFor(
      store.get("session.user.coverUrl"),
      store.get("session.user.coverIndex"),
    );
  },
);

computedAvatarStyle("session.user.avatarStyle", "session.user.avatarUrl");
computedAvatarStyle("typingState.avatarStyle", "typingState.avatarUrl");
computedAvatarStyle("visitorProfile.avatarStyle", "visitorProfile.avatarUrl");

function totalNotificationCount() {
  const notifs = store.get("notifications");
  return notifs ? Object.values(notifs).reduce((sum, n) => sum + (n || 0), 0) : 0;
}

store.computed("headerNotifBadge.text", ["notifications"], () => {
  const total = totalNotificationCount();
  return total > 99 ? "99+" : String(total);
});

store.computed("headerNotifBadge.class", ["notifications"], () => {
  return totalNotificationCount() > 0 ? "" : "d-none";
});

store.computed("activeGroupBadge.visible", ["activeDest"], () => {
  const dest = store.get("activeDest");
  return !!(dest && dest.type === "group");
});

store.computed("activeGroupBadge.memberCount", ["activeDest", "groupList"], () => {
  const dest = store.get("activeDest");
  if (!dest || dest.type !== "group") return 0;
  const groups = store.get("groupList") || [];
  const g = groups.find((x) => x.id === dest.value);
  return g ? g.memberCount : 0;
});

store.computed("typingState.class", ["typingState.active"], () => {
  return store.get("typingState.active") ? "show" : "";
});

store.computed("replyContextState.class", ["replyTarget"], () => {
  return store.get("replyTarget") ? "show" : "";
});

store.computed("replyContextState.title", ["replyTarget"], () => {
  const target = store.get("replyTarget");
  if (!target) return "";
  return target.isEdit ? "Editing message" : `Replying to ${target.displayName}`;
});

store.computed("replyContextState.text", ["replyTarget"], () => {
  const target = store.get("replyTarget");
  return target ? `"${target.content}"` : "";
});

store.computed("lightbox.class", ["lightbox.open"], () => {
  return store.get("lightbox.open") ? "show" : "";
});

store.computed("focusModeClass", ["focusMode"], () => {
  return store.get("focusMode") ? "focus-mode" : "";
});

store.computed("scrollFabBadgeText", ["scrollFabCount"], () => {
  const count = store.get("scrollFabCount") || 0;
  return count > 99 ? "99+" : String(count);
});

store.computed("scrollFabBadgeClass", ["scrollFabCount"], () => {
  return (store.get("scrollFabCount") || 0) > 0 ? "" : "d-none";
});

// History entries as objects so the template <for> can key them.
store.computed("searchHistoryItems", ["searchHistory"], () => {
  return (store.get("searchHistory") || []).map((q) => ({ q }));
});

// The panel shows only while the search bar is open and the input is empty,
// so it never covers live search results.
store.computed(
  "searchHistoryPanelVisible",
  ["searchState.searchOpen", "searchState.messageQuery", "searchHistory"],
  () => {
    if (!store.get("searchState.searchOpen")) return false;
    if ((store.get("searchState.messageQuery") || "").trim() !== "") return false;
    return (store.get("searchHistory") || []).length > 0;
  },
);

store.computed("attachedFilePreview", ["chatForm.attachedFileDetails"], () => {
  const details = store.get("chatForm.attachedFileDetails");
  return details ? [details] : [];
});

computedMatch("preferencesForm.appearanceTabClass", "preferencesForm.activeTab", "appearance", "active");
computedMatch("preferencesForm.privacyTabClass", "preferencesForm.activeTab", "privacy", "active");
computedMatch("preferencesForm.securityTabClass", "preferencesForm.activeTab", "security", "active");

computedMatch("preferencesForm.lightThemeClass", "preferencesForm.theme", "light", "active-theme");
computedMatch("preferencesForm.darkThemeClass", "preferencesForm.theme", "dark", "active-theme");

computedMatch("themeIcon", "prefs.theme", "dark", "bi-sun", "bi-moon-stars");

computedMatch("searchState.channelsClass", "searchState.activeTab", "channels", "active");
computedMatch("searchState.groupsClass", "searchState.activeTab", "groups", "active");
computedMatch("searchState.usersClass", "searchState.activeTab", "users", "active");

store.computed(
  "searchState.barClass",
  ["searchState.searchOpen"],
  () => store.get("searchState.searchOpen") ? "show" : "",
);

// data-show booleans for the destination dropdown tab panels
computedMatch("searchState.showChannels", "searchState.activeTab", "channels", true, false);
computedMatch("searchState.showGroups", "searchState.activeTab", "groups", true, false);
computedMatch("searchState.showUsers", "searchState.activeTab", "users", true, false);

store.computed(
  "visitorProfile.hasMutualGroups",
  ["visitorProfile.mutualGroups"],
  () => (store.get("visitorProfile.mutualGroups") || []).length > 0,
);
