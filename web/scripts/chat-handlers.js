import { store, CONFIG, coverStyleFor } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { TOKENS, clearAuthenticatedState, onAuthLoss, STORAGE, SESSION_STORAGE, tryRefreshTokens } from "./chat-auth.js";
import { apiFetch, ToastService, CAPTCHA, currentDeviceLabel, makeClientError, refreshAccountSecurityState, submitSafetyReport } from "./chat-api.js";
import { HELPERS, MAPPERS, decorateMessage, patchMessageById } from "./chat-messages.js";
import { showModal, hideModal, playBeep, hideSplashLoader } from "./chat-dialogs.js";
import { activeConversationId, setRoomMessages, appendRoomMessage, markConversationAsRead, closeDestinationDropdown, setActiveDestination, openDmWithUser, STATUS_BADGES } from "./chat-conversations.js";
import { UploadOverlay, destKeyForConversation, setupDragDropZone } from "./chat-media.js";
import { applySessionProfile, seedPreferencesForm, refreshUserProfile } from "./chat-profile.js";

// Load a user's profile into visitorProfile state and open the profile modal.
// Shared by the message header click, group-member list, and reaction popover.
export async function openUserProfileById(userId) {
  if (!userId) return;
  const currentUser = store.get("session.user");

  try {
    const profileRes = await wsClient.request("profile.get", { userId });
    const profile = MAPPERS.profile(profileRes.profile);
    const isSelf = !!(currentUser && profile.id === currentUser.id);
    const st = STATUS_BADGES[profile.status] || STATUS_BADGES.offline;

    // Mutual groups: probe each of my groups' member lists for the target user.
    let mutualGroups = [];
    if (!isSelf) {
      const groups = store.get("groupList") || [];
      const results = await Promise.all(groups.map(async (g) => {
        try {
          const res = await wsClient.request("group.members", { groupId: g.id });
          return res.members.some((m) => m.id === profile.id) ? { id: g.id, name: g.name } : null;
        } catch {
          return null;
        }
      }));
      mutualGroups = results.filter(Boolean);
    }

    store.set("visitorProfile", {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      statusColor: st.dot,
      statusGlow: st.glow,
      statusBadgeClass: st.class,
      statusText: st.text,
      joinedDate: profile.joinedDate,
      messagesSent: profile.messagesSent,
      reactionsAdded: profile.reactionsAdded,
      repliesMade: profile.repliesMade,
      isPremium: !!profile.isPremium,
      mutualGroups,
      mutualGroupsCount: mutualGroups.length,
      coverStyle: coverStyleFor(profile.coverUrl, profile.coverIndex),
      nameColor: profile.nameColor || "var(--text-dark)",
      isSelf,
      handleDisplay: `@${profile.username}`,
    });

    showModal("visitorProfileModal");
  } catch (err) {
    console.error("View profile failed:", err);
  }
}

export const ChatService = {
  getMessageById: (messageId) => {
    const key = store.get("activeDestKey");
    const destMsgs = store.get(`messages.${key}`) || [];
    return destMsgs.find((m) => m.id === messageId);
  },
};

export function ensureEmojiPickerMounted() {
  const popover = document.getElementById("emojiPopoverContainer");
  if (!popover) return;

  const currentTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  const activeTheme = popover.getAttribute("data-active-theme");

  if (activeTheme !== currentTheme) {
    popover.innerHTML = "";
  }

  if (!popover.hasChildNodes()) {
    popover.setAttribute("data-active-theme", currentTheme);
    const pickerOptions = {
      onEmojiSelect: async (emoji) => {
        const purpose = popover.getAttribute("data-purpose");
        if (purpose === "reaction") {
          const msgId = popover.getAttribute("data-target-msg-id");
          try {
            await wsClient.request("reaction.toggle", { messageId: msgId, emoji: emoji.native });
          } catch (err) {
            console.error("Reaction toggle failed:", err);
          }
        } else {
          const currentVal = store.get("chatForm.messageInput") || "";
          store.set("chatForm.messageInput", currentVal + emoji.native);
          const input = document.getElementById("messageInput");
          if (input) input.focus();
        }
        popover.className = "emoji-picker-popover";
      },
      theme: currentTheme,
      set: "apple",
      previewPosition: "none",
      navPosition: "bottom",
    };

    const picker = new EmojiMart.Picker(pickerOptions);
    popover.appendChild(picker);
  }
}

export function showReactionUsersPopover(anchorEl, emoji, userIds) {
  const existing = document.getElementById("reactionUsersPopover");
  if (existing) existing.remove();

  if (!userIds || userIds.length === 0) return;

  const usersMap = store.get("users") || {};
  const currentUser = store.get("session.user");

  const avatarList = userIds.map((uid) => {
    const userSummary = usersMap[uid];
    const displayName = HELPERS.sanitize(userSummary ? userSummary.displayName : "Unknown");
    const isMe = currentUser && currentUser.id === uid;
    const avatarUrl = userSummary?.avatarUrl || HELPERS.dicebearUrl(uid);
    return `
      <div class="reaction-user-row" data-user-id="${uid}" style="cursor:pointer;">
        <img src="${avatarUrl}" alt="" class="reaction-user-avatar">
        <span class="reaction-user-name">${displayName}${
      isMe ? ' <span class="reaction-you-badge">you</span>' : ""
    }</span>
        <i class="bi bi-chevron-right reaction-user-chevron"></i>
      </div>
    `;
  }).join("");

  const popover = document.createElement("div");
  popover.id = "reactionUsersPopover";
  popover.className = "reaction-users-popover";
  popover.innerHTML = `
    <div class="reaction-popover-header">${HELPERS.sanitize(emoji)} · ${userIds.length} reaction${
    userIds.length > 1 ? "s" : ""
  }</div>
    <div class="reaction-popover-list">${avatarList}</div>
  `;

  document.body.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  popover.style.visibility = "hidden";
  popover.style.top = "-9999px";
  popover.style.left = "-9999px";

  requestAnimationFrame(() => {
    const popH = popover.offsetHeight || 180;
    const popW = popover.offsetWidth || 200;

    let top = rect.top - popH - 8;
    if (top < 8) top = rect.bottom + 8;

    let left = rect.left;
    if (left + popW > window.innerWidth - 8) {
      left = window.innerWidth - popW - 8;
    }
    if (left < 8) left = 8;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = "";

    requestAnimationFrame(() => popover.classList.add("visible"));
  });

  popover.addEventListener("click", (evt) => {
    const row = evt.target.closest("[data-user-id]");
    if (!row) return;
    const uid = row.getAttribute("data-user-id");
    popover.classList.remove("visible");
    setTimeout(() => {
      popover.remove();
      openUserProfileById(uid);
    }, 180);
  });

  const dismiss = (evt) => {
    if (!popover.contains(evt.target)) {
      popover.classList.remove("visible");
      setTimeout(() => popover.remove(), 200);
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
  }, 50);
}

// Post-auth bootstrap shared by sign-in, sign-up and session restore
export async function afterLogin(profileWire) {
  applySessionProfile(profileWire);
  store.set("session.loggedIn", true);

  await wsClient.connect();

  try {
    const prefsRes = await wsClient.request("preferences.get", {});
    const prefs = MAPPERS.preferences(prefsRes.preferences);
    store.set("prefs", prefs);
    applyTheme(prefs.theme);
    seedPreferencesForm(prefs);
  } catch (err) {
    console.warn("Failed to load preferences:", err);
  }

  try {
    await refreshAccountSecurityState();
  } catch (err) {
    console.warn("Failed to load account security state:", err);
  }

  await loadInitialData();

  const pendingEmailChangeToken = store.get("authState.pendingEmailChangeToken");
  if (pendingEmailChangeToken) {
    store.set("authState.pendingEmailChangeToken", "");
    try {
      await completePendingEmailChangeToken(pendingEmailChangeToken);
    } catch (err) {
      console.error("Deferred email change completion failed:", err);
    }
  }
}

export function applyTheme(theme) {
  applySystemTheme(theme);
}

export function applySystemTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    STORAGE.setItem("chat_dark_mode", "1");
  } else {
    document.body.classList.remove("dark-mode");
    STORAGE.setItem("chat_dark_mode", "0");
  }
}

export async function loadSessionList() {
  const data = await apiFetch("/api/auth/sessions");
  store.set("sessionList", data.sessions || []);
}

export async function completePendingEmailChangeToken(token) {
  await apiFetch("/api/auth/email-change/complete", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  await refreshAccountSecurityState();
  await loadSessionList();
  ToastService.show("Email address updated successfully.", "success");
}

export function removeSecurityQueryParam(name) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState({}, "", url.toString());
}

export async function handleSecurityQueryParams() {
  const url = new URL(window.location.href);
  const verifyToken = url.searchParams.get("verify_email");
  const resetToken = url.searchParams.get("reset_password");
  const emailChangeToken = url.searchParams.get("change_email");

  if (verifyToken) {
    try {
      await apiFetch("/api/auth/verify-email/complete", {
        method: "POST",
        body: JSON.stringify({ token: verifyToken }),
      });
      removeSecurityQueryParam("verify_email");
      if (store.get("session.loggedIn")) {
        await refreshAccountSecurityState();
      }
      ToastService.show("Email verified successfully.", "success");
    } catch (err) {
      console.error("Email verification failed:", err);
    }
  }

  if (resetToken) {
    store.set("authState.resetMode", true);
    store.set("authState.resetToken", resetToken);
    removeSecurityQueryParam("reset_password");
  }

  if (emailChangeToken) {
    removeSecurityQueryParam("change_email");
    if (store.get("session.loggedIn")) {
      try {
        await completePendingEmailChangeToken(emailChangeToken);
      } catch (err) {
        console.error("Email change completion failed:", err);
      }
    } else {
      store.set("authState.pendingEmailChangeToken", emailChangeToken);
      ToastService.show("Sign in to complete your email change.", "info");
    }
  }
}

export function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export async function initApp() {
  await CAPTCHA.initialize();
  await handleSecurityQueryParams();
  const tokens = TOKENS.get();
  if (!tokens) {
    store.set("session.loggedIn", false);
    hideSplashLoader();
    return;
  }

  try {
    if (!(await tryRefreshTokens())) {
      clearAuthenticatedState();
      hideSplashLoader();
      return;
    }
  } catch (err) {
    console.warn("Refresh failed, attempting with existing tokens:", err);
  }

  try {
    await wsClient.connect();
    const userId = parseJwt(TOKENS.get().accessToken).sub;
    const profileRes = await wsClient.request("profile.get", { userId });
    await afterLogin(profileRes.profile);
    hideSplashLoader();
  } catch (err) {
    console.error("Failed to restore session:", err);
    clearAuthenticatedState();
    hideSplashLoader();
  }
}

export async function loadInitialData() {
  try {
    const [channelsResult, groupsResult, dmsResult] = await Promise.all([
      wsClient.request("channel.list", {}),
      wsClient.request("group.list", {}),
      wsClient.request("dm.list", {}),
    ]);
    store.set("channelList", channelsResult.channels.map(MAPPERS.conversation));
    store.set("groupList", groupsResult.groups.map(MAPPERS.conversation));

    const dmRooms = dmsResult.rooms.map(MAPPERS.conversation);
    const currentUser = store.get("session.user");

    const resolvedDms = (await Promise.all(dmRooms.map(async (dmRoom) => {
      try {
        const membersResult = await wsClient.request("group.members", { groupId: dmRoom.id });
        const partner = membersResult.members.find((m) => m.id !== currentUser.id);
        if (!partner) return null;
        const summary = MAPPERS.userSummary(partner);
        store.set(`users.${partner.id}`, { ...store.get(`users.${partner.id}`), ...summary });
        return { ...summary, conversationId: dmRoom.id };
      } catch (err) {
        console.error(`Failed to resolve members for DM room ${dmRoom.id}:`, err);
        return null;
      }
    }))).filter(Boolean);
    store.set("resolvedDms", resolvedDms);

    const activeDest = store.get("activeDest");
    if (activeDest) {
      await loadConversationHistory(activeDest, activeConversationId());
    }
  } catch (err) {
    console.error("Failed to load initial data:", err);
  }
}

export async function ensureUsersKnown(userIds) {
  const unknown = [...new Set(userIds.filter((id) => id && !store.get(`users.${id}`)))];
  await Promise.all(unknown.map(refreshUserProfile));
}

export async function loadConversationHistory(dest, conversationId) {
  if (!conversationId) return;
  try {
    const historyResult = await wsClient.request("message.history", { conversationId, limit: 100 });
    const messages = historyResult.messages.map(MAPPERS.message);

    await ensureUsersKnown(messages.map((m) => m.authorId));

    setRoomMessages(`${dest.type}_${dest.value}`, messages);
  } catch (err) {
    console.error("Failed to load message history:", err);
  }
}

// Debounced typing tracking
let typingTimeout = null;
let isTypingSent = false;

export function sendTypingStart(conversationId) {
  if (!conversationId) return;
  if (isTypingSent) {
    clearTimeout(typingTimeout);
  } else {
    wsClient.request("typing.start", { conversationId }).catch(() => {});
    isTypingSent = true;
  }
  typingTimeout = setTimeout(() => {
    sendTypingStop(conversationId);
  }, 4000);
}

export function sendTypingStop(conversationId) {
  if (isTypingSent) {
    clearTimeout(typingTimeout);
    if (conversationId) wsClient.request("typing.stop", { conversationId }).catch(() => {});
    isTypingSent = false;
  }
}

// Event Handlers for UI components
export const handlers = {
  async toggleTheme() {
    const currentTheme = store.get("prefs.theme");
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    store.set("prefs.theme", nextTheme);
    applyTheme(nextTheme);
    seedPreferencesForm(store.get("prefs"));

    if (store.get("session.loggedIn")) {
      try {
        await wsClient.request("preferences.update", {
          sound: !!store.get("prefs.sound"),
          desktopNotifications: !!store.get("prefs.desktopNotif"),
          dmPrivacy: store.get("prefs.dmPrivacy"),
          groupPrivacy: store.get("prefs.groupPrivacy"),
          theme: nextTheme,
        });
      } catch (err) {
        console.warn("Failed to update theme on server:", err);
      }
    }
  },

  scrollToMessage(e, el) {
    e?.stopPropagation?.();
    const targetId = el.getAttribute("data-target-id");
    if (!targetId) return;
    const msgEl = document.getElementById(`group_${targetId}`) ||
      document.getElementById(`msg_${targetId}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
      msgEl.classList.add("message-highlight");
      setTimeout(() => {
        msgEl.classList.remove("message-highlight");
      }, 2000);
    }
  },

  showSignInTab() {
    store.set("authState.resetMode", false);
    store.set("authState.activeTab", "signin");
    store.set("authState.signinClass", "active");
    store.set("authState.signupClass", "");
  },

  showSignUpTab() {
    store.set("authState.resetMode", false);
    store.set("authState.activeTab", "signup");
    store.set("authState.signinClass", "");
    store.set("authState.signupClass", "active");
  },

  showPasswordResetRequest() {
    store.set("authState.resetMode", true);
    store.set("authState.resetToken", "");
    store.set("authState.resetEmail", store.get("authState.signinEmail") || "");
    store.set("authState.resetNewPassword", "");
    store.set("authState.resetConfirmPassword", "");
  },

  cancelPasswordReset() {
    store.set("authState.resetMode", false);
    store.set("authState.resetToken", "");
    store.set("authState.resetNewPassword", "");
    store.set("authState.resetConfirmPassword", "");
    handlers.showSignInTab();
  },

  async handleSignIn() {
    const email = (store.get("authState.signinEmail") || "").trim();
    const pass = store.get("authState.signinPassword") || "";
    const rememberMe = !!store.get("authState.signinRememberMe");

    if (!email || !pass) {
      ToastService.show("All fields are required.", "warning");
      return;
    }

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: pass,
          rememberMe,
          deviceLabel: currentDeviceLabel(),
          captchaToken: CAPTCHA.consume("login"),
        }),
      });

      TOKENS.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, rememberMe);
      store.set("authState.signinEmail", "");
      store.set("authState.signinPassword", "");
      store.set("authState.signinRememberMe", false);

      await afterLogin(data.user);

      ToastService.show(
        `Welcome back to CentrumChat workspace, ${data.user.displayName}!`,
        "success",
      );
    } catch (err) {
      console.error("Sign in failed:", err);
    }
  },

  async handleSignUp() {
    const username = (store.get("authState.signupUsername") || "").trim();
    const email = (store.get("authState.signupEmail") || "").trim();
    const pass = store.get("authState.signupPassword") || "";
    const rememberMe = !!store.get("authState.signupRememberMe");

    if (!username || !email || !pass) {
      ToastService.show("All fields are required.", "warning");
      return;
    }

    if (pass.length < 8) {
      ToastService.show("Password must be at least 8 characters.", "warning");
      return;
    }

    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email,
          password: pass,
          displayName: username,
          rememberMe,
          deviceLabel: currentDeviceLabel(),
          captchaToken: CAPTCHA.consume("register"),
        }),
      });

      TOKENS.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, rememberMe);
      store.set("authState.signupUsername", "");
      store.set("authState.signupEmail", "");
      store.set("authState.signupPassword", "");
      store.set("authState.signupRememberMe", false);

      await afterLogin(data.user);

      ToastService.show(`Welcome to CentrumChat workspace, ${data.user.displayName}!`, "success");
    } catch (err) {
      console.error("Sign up failed:", err);
    }
  },

  async handleLogout() {
    const tokens = TOKENS.get();
    if (tokens?.refreshToken) {
      try {
        await apiFetch("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
      } catch (err) {
        console.warn("Logout endpoint failed:", err);
      }
    }
    clearAuthenticatedState("Logged out successfully.", "info");
  },

  showChannelsTab() {
    store.set("searchState.activeTab", "channels");
  },
  showGroupsTab() {
    store.set("searchState.activeTab", "groups");
  },
  showUsersTab() {
    store.set("searchState.activeTab", "users");
  },

  async selectChannel(e, el) {
    e?.preventDefault?.();
    const slug = el.getAttribute("data-id");
    setActiveDestination("channel", slug);
    closeDestinationDropdown();
    const chan = (store.get("channelList") || []).find((c) => c.slug === slug);
    if (chan) {
      await loadConversationHistory({ type: "channel", value: slug }, chan.id);
      markConversationAsRead(chan.id);
    }
  },

  async selectGroup(e, el) {
    e?.preventDefault?.();
    const groupId = el.getAttribute("data-id");
    setActiveDestination("group", groupId);
    closeDestinationDropdown();
    await loadConversationHistory({ type: "group", value: groupId }, groupId);
    markConversationAsRead(groupId);
  },

  async selectDm(e, el) {
    e?.preventDefault?.();
    const userId = el.getAttribute("data-id");
    closeDestinationDropdown();
    await openDmWithUser(userId, loadInitialData, loadConversationHistory);
  },

  closeProfileDropdown() {
    const btn = document.getElementById("profileDropdownBtn");
    if (btn) {
      const bsDropdown = window.bootstrap?.Dropdown?.getInstance(btn);
      if (bsDropdown) bsDropdown.hide();
    }
  },

  startProfileEdit() {
    const user = store.get("session.user") || {};
    store.set("session.profileDraft.displayName", user.displayName || "");
    store.set("session.profileDraft.bio", user.bio || CONFIG.defaultBio);
    store.set("session.isEditingProfile", true);
  },

  cancelProfileEdit() {
    store.set("session.isEditingProfile", false);
  },

  async saveProfileEdit() {
    const draft = store.get("session.profileDraft") || {};
    const displayName = (draft.displayName || "").trim();
    const bio = (draft.bio || "").trim();
    if (!displayName) {
      ToastService.show("Display name cannot be empty.", "warning");
      return;
    }
    try {
      const profileRes = await wsClient.request("profile.update", {
        displayName,
        bio: bio || CONFIG.defaultBio,
      });
      applySessionProfile(profileRes.profile);
      store.set("session.isEditingProfile", false);
      ToastService.show("Profile updated successfully.", "success");
    } catch (err) {
      console.error("Profile save failed:", err);
      ToastService.show("Failed to update profile.", "error");
    }
  },

  async rotateAvatarSeed() {
    const currentUser = store.get("session.user");
    const seeds = CONFIG.avatarSeeds;
    let seed = seeds[Math.floor(Math.random() * seeds.length)];
    if (seed === currentUser?.avatarSeed) {
      seed = `${seed}-${Math.random().toString(36).slice(2, 6)}`;
    }

    try {
      const profileRes = await wsClient.request("profile.update", { avatarSeed: seed });
      applySessionProfile(profileRes.profile);
      ToastService.show("Avatar regenerated successfully.", "success");
    } catch (err) {
      console.error("Avatar rotate failed:", err);
    }
  },

  async openPreferences() {
    const user = store.get("session.user");
    if (!user) return;

    seedPreferencesForm(store.get("prefs"));
    store.set("preferencesForm.activeTab", "appearance");
    try {
      await refreshAccountSecurityState();
      await loadSessionList();
    } catch (err) {
      console.warn("Failed to load account security details:", err);
    }

    handlers.closeProfileDropdown();

    showModal("preferencesModal");
  },

  showPrefAppearanceTab() {
    store.set("preferencesForm.activeTab", "appearance");
  },
  showPrefPrivacyTab() {
    store.set("preferencesForm.activeTab", "privacy");
  },
  showPrefSecurityTab() {
    store.set("preferencesForm.activeTab", "security");
  },

  setPrefThemeLight() {
    store.set("preferencesForm.theme", "light");
  },
  setPrefThemeDark() {
    store.set("preferencesForm.theme", "dark");
  },

  async updatePassword() {
    const currentPass = store.get("preferencesForm.currentPassword");
    const newPass = store.get("preferencesForm.newPassword");
    const confirmPass = store.get("preferencesForm.confirmPassword");

    if (!currentPass || !newPass || !confirmPass) {
      ToastService.show("All password fields are required.", "warning");
      return;
    }

    if (newPass.length < 8) {
      ToastService.show("New password must be at least 8 characters.", "warning");
      return;
    }

    if (newPass !== confirmPass) {
      ToastService.show("Confirm password does not match.", "warning");
      return;
    }

    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
      });
      ToastService.show("Password updated successfully!", "success");

      store.set("preferencesForm.currentPassword", "");
      store.set("preferencesForm.newPassword", "");
      store.set("preferencesForm.confirmPassword", "");
    } catch (err) {
      console.error("Password update failed:", err);
    }
  },

  async requestPasswordReset() {
    const email = (store.get("authState.resetEmail") || "").trim();
    if (!email) {
      ToastService.show("Email is required.", "warning");
      return;
    }
    try {
      const data = await apiFetch("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email, captchaToken: CAPTCHA.consume("password_reset") }),
      });
      ToastService.show(data.message || "Password reset requested.", "info");
      handlers.cancelPasswordReset();
    } catch (err) {
      console.error("Password reset request failed:", err);
    }
  },

  async completePasswordReset() {
    const token = store.get("authState.resetToken");
    const newPassword = store.get("authState.resetNewPassword") || "";
    const confirmPassword = store.get("authState.resetConfirmPassword") || "";
    if (!token || !newPassword || !confirmPassword) {
      ToastService.show("All password reset fields are required.", "warning");
      return;
    }
    if (newPassword.length < 8) {
      ToastService.show("New password must be at least 8 characters.", "warning");
      return;
    }
    if (newPassword !== confirmPassword) {
      ToastService.show("Confirm password does not match.", "warning");
      return;
    }
    try {
      await apiFetch("/api/auth/password-reset/complete", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      store.set("authState.resetToken", "");
      store.set("authState.resetNewPassword", "");
      store.set("authState.resetConfirmPassword", "");
      store.set("authState.resetMode", false);
      ToastService.show("Password reset successfully. Sign in with your new password.", "success");
      handlers.showSignInTab();
    } catch (err) {
      console.error("Password reset completion failed:", err);
    }
  },

  async resendVerificationEmail() {
    try {
      const data = await apiFetch("/api/auth/verify-email/resend", { method: "POST" });
      await refreshAccountSecurityState();
      if (data.alreadyVerified) {
        ToastService.show("Your email address is already verified.", "info");
      } else if (data.sent) {
        ToastService.show("Verification email sent.", "success");
      } else {
        ToastService.show("Verification email could not be sent right now.", "warning");
      }
    } catch (err) {
      console.error("Verification resend failed:", err);
    }
  },

  async revokeSession(e, el) {
    e?.preventDefault?.();
    const sessionId = el.getAttribute("data-session-id");
    if (!sessionId) return;
    try {
      const result = await apiFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (result.revokedCurrent) {
        clearAuthenticatedState("Current session revoked. Please sign in again.", "warning");
        return;
      }
      await loadSessionList();
      ToastService.show("Session revoked.", "success");
    } catch (err) {
      console.error("Session revoke failed:", err);
    }
  },

  async revokeOtherSessions() {
    try {
      const result = await apiFetch("/api/auth/sessions/others", { method: "DELETE" });
      await loadSessionList();
      ToastService.show(
        `${result.revokedCount || 0} other session${result.revokedCount === 1 ? "" : "s"} revoked.`,
        "success",
      );
    } catch (err) {
      console.error("Revoke other sessions failed:", err);
    }
  },

  async startEmailChange() {
    const currentPassword = store.get("preferencesForm.currentPassword") || "";
    const newEmail = (store.get("preferencesForm.newEmail") || "").trim();
    if (!currentPassword || !newEmail) {
      ToastService.show("Current password and new email are required.", "warning");
      return;
    }
    try {
      await apiFetch("/api/auth/email-change/start", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newEmail }),
      });
      store.set("preferencesForm.newEmail", "");
      await refreshAccountSecurityState();
      ToastService.show("Check your new email address to complete the change.", "success");
    } catch (err) {
      console.error("Email change start failed:", err);
    }
  },

  async savePreferences() {
    const updatedColor = store.get("preferencesForm.nameColor");
    const contrastRatio = HELPERS.getContrastRatio(updatedColor, "#ffffff");

    if (contrastRatio < 3.0) {
      ToastService.show(
        `Contrast ratio is too low for light mode (Contrast: ${
          contrastRatio.toFixed(1)
        }:1). Please pick a darker name color.`,
        "warning",
      );
      return;
    }

    const targetTheme = store.get("preferencesForm.theme");
    applyTheme(targetTheme);

    try {
      const isPremium = !!store.get("preferencesForm.isPremium");
      const profileRes = await wsClient.request("profile.update", {
        nameColor: updatedColor,
        isPremium,
      });
      applySessionProfile(profileRes.profile);

      const prefsRes = await wsClient.request("preferences.update", {
        sound: !!store.get("preferencesForm.sound"),
        desktopNotifications: !!store.get("preferencesForm.desktopNotif"),
        dmPrivacy: store.get("preferencesForm.dmPrivacy"),
        groupPrivacy: store.get("preferencesForm.groupPrivacy"),
        theme: targetTheme,
      });
      const prefs = MAPPERS.preferences(prefsRes.preferences);
      store.set("prefs", prefs);

      if (prefs.desktopNotif && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      hideModal("preferencesModal");

      ToastService.show("Preferences saved successfully!", "success");
    } catch (err) {
      console.error("Preferences save failed:", err);
    }
  },

  toggleFocusMode() {
    store.set("focusMode", !store.get("focusMode"));
  },

  toggleSearch() {
    const current = store.get("searchState.searchOpen");
    store.set("searchState.searchOpen", !current);
    if (!current) {
      setTimeout(() => {
        const input = document.getElementById("messageSearchInput");
        if (input) input.focus();
      }, 100);
    } else {
      store.set("searchState.messageQuery", "");
    }
  },

  clearMessageSearch() {
    store.set("searchState.messageQuery", "");
    const input = document.getElementById("messageSearchInput");
    if (input) input.focus();
  },

  triggerFileAttach() {
    showModal("uploadAttachmentModal");
  },

  clickHiddenUploadInput() {
    const fileInput = document.getElementById("modalFileInput");
    if (fileInput) fileInput.click();
  },

  async modalUploadFile(file) {
    if (!file) return;
    if (!UploadOverlay.showWorking("Uploading file...")) return;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");

    const tokens = TOKENS.get();
    if (tokens?.accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${tokens.accessToken}`);
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        UploadOverlay.setProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        ToastService.show("Upload failed. Please try again.", "error");
        UploadOverlay.hide();
        return;
      }
      try {
        const res = JSON.parse(xhr.responseText);
        const attachmentId = res.data?.attachmentId;
        const freshTokens = TOKENS.get();
        const tokenParam = freshTokens?.accessToken
          ? `?token=${encodeURIComponent(freshTokens.accessToken)}`
          : "";

        store.set("chatForm.attachedFileDetails", {
          name: file.name,
          size: file.size,
          type: file.type,
          isImage: file.type.startsWith("image/"),
          url: `/media/${attachmentId}${tokenParam}`,
          sizeFormatted: HELPERS.formatBytes(file.size),
        });
        store.set("chatForm.attachedFileId", attachmentId);

        UploadOverlay.showSuccess();
        setTimeout(() => {
          hideModal("uploadAttachmentModal");
          UploadOverlay.hide();
        }, 1000);
      } catch (err) {
        console.error("Parse error:", err);
        ToastService.show("Upload complete, but failed to parse response.", "error");
        UploadOverlay.hide();
      }
    };

    xhr.onerror = () => {
      ToastService.show("Network error during upload.", "error");
      UploadOverlay.hide();
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  },

  async uploadFromUrl() {
    const urlInput = document.getElementById("uploadUrlInput");
    const url = urlInput?.value.trim();
    if (!url) {
      ToastService.show("Please enter a valid URL.", "warning");
      return;
    }

    UploadOverlay.showWorking("Fetching file from URL...", "Connecting...", "50%");

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();

      let filename = "pasted-file";
      try {
        const lastPart = new URL(url).pathname.split("/").pop();
        filename = lastPart && lastPart.includes(".")
          ? lastPart
          : `pasted-file.${blob.type.split("/")[1] || "bin"}`;
      } catch (_) { }

      urlInput.value = "";
      handlers.modalUploadFile(new File([blob], filename, { type: blob.type }));
    } catch (err) {
      console.error("Failed to fetch URL:", err);
      ToastService.show(
        "Failed to retrieve file from URL. (CORS restriction or invalid link)",
        "error",
      );
      UploadOverlay.hide();
    }
  },

  clearAttachedFile() {
    store.set("chatForm.attachedFileId", null);
    store.set("chatForm.attachedFileDetails", null);
  },

  handleMessageInputKeydown(e) {
    sendTypingStart(activeConversationId());

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handlers.handleSendMessage();
    }
  },

  async handleSendMessage() {
    const text = (store.get("chatForm.messageInput") || "").trim();
    const attachmentId = store.get("chatForm.attachedFileId");
    const replyTarget = store.get("replyTarget");

    if (!text && !attachmentId) return;

    const conversationId = activeConversationId();
    if (!conversationId) return;

    sendTypingStop(conversationId);

    try {
      if (replyTarget && replyTarget.isEdit) {
        await wsClient.request("message.edit", {
          messageId: replyTarget.id,
          content: text,
        });
      } else {
        await wsClient.request("message.send", {
          conversationId,
          content: text,
          replyToId: replyTarget ? replyTarget.id : undefined,
          attachmentId: attachmentId || undefined,
        });
      }

      store.set("chatForm.messageInput", "");
      store.set("chatForm.attachedFileId", null);
      store.set("chatForm.attachedFileDetails", null);
      store.set("replyTarget", null);
    } catch (err) {
      console.error("Failed to send/edit message:", err);
    }
  },

  cancelReply() {
    const replyTarget = store.get("replyTarget");
    store.set("replyTarget", null);
    if (replyTarget && replyTarget.isEdit) {
      store.set("chatForm.messageInput", "");
    }
  },

  startReply(e, el) {
    const msgId = el.getAttribute("data-id");
    const msg = ChatService.getMessageById(msgId);
    if (msg) {
      const author = store.get(`users.${msg.authorId}`);
      store.set("replyTarget", {
        id: msg.id,
        displayName: author?.displayName || "Unknown",
        content: msg.content,
        isEdit: false,
      });
      const input = document.getElementById("messageInput");
      if (input) input.focus();
    }
  },

  startEditMsg(e, el) {
    const msgId = el.getAttribute("data-id");
    const msg = ChatService.getMessageById(msgId);
    if (msg) {
      store.set("replyTarget", {
        id: msg.id,
        displayName: "Editing message",
        content: msg.content,
        isEdit: true,
      });
      store.set("chatForm.messageInput", msg.content);
      const input = document.getElementById("messageInput");
      if (input) input.focus();
    }
  },

  deleteMsg(e, el) {
    store.set("session.messageToDeleteId", el.getAttribute("data-id"));
    showModal("deleteMessageConfirmModal");
  },

  async confirmDeleteMsg() {
    const msgId = store.get("session.messageToDeleteId");
    if (!msgId) return;
    try {
      await wsClient.request("message.delete", { messageId: msgId, confirm: true });
      ToastService.show("Message deleted.", "info");

      hideModal("deleteMessageConfirmModal");
    } catch (err) {
      console.error("Message deletion failed:", err);
      ToastService.show("Failed to delete message.", "error");
    } finally {
      store.set("session.messageToDeleteId", null);
    }
  },

  showMsgReactionPicker(e, el) {
    e.stopPropagation();
    const msgId = el.getAttribute("data-id");
    const popover = document.getElementById("emojiPopoverContainer");
    if (!popover) return;

    popover.setAttribute("data-purpose", "reaction");
    popover.setAttribute("data-target-msg-id", msgId);

    if (window.innerWidth <= 1024) {
      popover.style.top = "";
      popover.style.left = "";
      popover.style.bottom = "";
      popover.style.right = "";
      popover.className = "emoji-picker-popover mobile-docked";
    } else {
      const rect = el.getBoundingClientRect();
      const cardEl = document.querySelector(".glass-card");
      const cardRect = cardEl
        ? cardEl.getBoundingClientRect()
        : { top: 0, left: 0, width: window.innerWidth };

      const pickerHeight = 435;
      const pickerWidth = 352;

      let top = rect.top - cardRect.top - pickerHeight - 10;
      let left = rect.left - cardRect.left - (pickerWidth / 2) + (rect.width / 2);

      if (top < 10) top = rect.bottom - cardRect.top + 10;
      if (left < 10) left = 10;
      else if (left + pickerWidth > cardRect.width - 10) left = cardRect.width - pickerWidth - 10;

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.bottom = "auto";
      popover.style.right = "auto";
      popover.className = "emoji-picker-popover desktop-reaction";
    }

    ensureEmojiPickerMounted();
  },

  async toggleReaction(e, el) {
    const msgId = el.getAttribute("data-msg-id");
    const emoji = el.getAttribute("data-emoji");
    if (e && e.ctrlKey) {
      const msg = ChatService.getMessageById(msgId);
      if (msg && msg.reactions && msg.reactions[emoji]) {
        showReactionUsersPopover(el, emoji, msg.reactions[emoji]);
      }
      return;
    }
    try {
      await wsClient.request("reaction.toggle", { messageId: msgId, emoji });
    } catch (err) {
      console.error("Toggle reaction failed:", err);
    }
  },

  scrollToBottom() {
    const stream = document.getElementById("messageStream");
    if (stream) {
      stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
    }
  },

  openLightbox(e, el) {
    e?.stopPropagation?.();
    const src = el.getAttribute("src");
    store.set("lightbox.imgSrc", src || "");
    store.set("lightbox.open", true);
  },

  closeLightbox() {
    store.set("lightbox.open", false);
    store.set("lightbox.imgSrc", "");
  },

  openProfileImagesModal() {
    store.set("profileImagesForm", {
      avatarFile: null,
      coverFile: null,
    });

    const file1 = document.getElementById("avatarFileInput");
    const file2 = document.getElementById("coverFileInput");
    if (file1) file1.value = "";
    if (file2) file2.value = "";

    handlers.closeProfileDropdown();

    showModal("profileImagesModal");
  },

  handleAvatarFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      store.set("profileImagesForm.avatarFile", file);
      ToastService.show(`Selected avatar file: ${file.name}`, "info");
    }
  },

  handleCoverFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      store.set("profileImagesForm.coverFile", file);
      ToastService.show(`Selected cover file: ${file.name}`, "info");
    }
  },

  async saveProfileGraphics() {
    const avatarFile = store.get("profileImagesForm.avatarFile");
    const coverFile = store.get("profileImagesForm.coverFile");

    try {
      if (avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        const res = await apiFetch("/api/media/avatar", {
          method: "POST",
          body: formData,
        });
        const user = store.get("session.user");
        store.set("session.user", { ...user, avatarUrl: res.avatarUrl });
      }

      if (coverFile) {
        const formData = new FormData();
        formData.append("file", coverFile);
        const res = await apiFetch("/api/media/cover", {
          method: "POST",
          body: formData,
        });
        const user = store.get("session.user");
        store.set("session.user", { ...user, coverUrl: res.coverUrl });
      }

      hideModal("profileImagesModal");

      ToastService.show("Profile graphics updated successfully!", "success");
    } catch (err) {
      console.error("Graphics update failed:", err);
    }
  },

  async viewUserProfile(e, el) {
    await openUserProfileById(el.getAttribute("data-user-id"));
  },

  openPrefsFromProfile() {
    setTimeout(() => {
      handlers.openPreferences();
    }, 300);
  },

  openProfileImagesFromProfile() {
    setTimeout(() => {
      handlers.openProfileImagesModal();
    }, 300);
  },

  messageUserFromProfile() {
    const visitorId = store.get("visitorProfile.id");
    if (visitorId) {
      openDmWithUser(visitorId, loadInitialData, loadConversationHistory);
    }
  },

  mentionUserFromProfile() {
    const visitor = store.get("visitorProfile.username");
    const currentVal = store.get("chatForm.messageInput") || "";
    store.set("chatForm.messageInput", `@${visitor} ` + currentVal);
    const input = document.getElementById("messageInput");
    if (input) input.focus();
  },

  async toggleBlockFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (!userId || !window.confirm("Block this user and disable direct interaction?")) return;
    try {
      await apiFetch("/api/safety/blocks/" + encodeURIComponent(userId), { method: "PUT" });
      hideModal("visitorProfileModal");
      ToastService.show("User blocked.", "info");
    } catch (error) {
      console.error("Block action failed:", error);
    }
  },

  async unblockFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (!userId) return;
    try {
      await apiFetch("/api/safety/blocks/" + encodeURIComponent(userId), { method: "DELETE" });
      ToastService.show("User unblocked.", "info");
    } catch (error) {
      console.error("Unblock action failed:", error);
    }
  },

  async reportUserFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (userId) await submitSafetyReport("user", userId);
  },

  async reportMessage(_event, element) {
    const messageId = element.getAttribute("data-id");
    if (messageId) await submitSafetyReport("message", messageId);
  },

  async reportAttachment(_event, element) {
    const attachmentId = element.getAttribute("data-id");
    if (attachmentId) await submitSafetyReport("attachment", attachmentId);
  },

  openCreateGroup() {
    const resolvedDms = store.get("resolvedDms") || [];
    const dmCandidates = resolvedDms.map((d) => ({
      id: d.id,
      username: d.username,
      displayName: d.displayName,
      avatarUrl: d.avatarUrl,
    }));

    store.set("createGroupForm", {
      name: "",
      candidateUsers: dmCandidates,
      selectedUserIds: [],
    });

    showModal("createGroupModal");
  },

  toggleGroupMemberSelection(e, el) {
    const val = el.value;
    let selected = [...(store.get("createGroupForm.selectedUserIds") || [])];
    if (el.checked) {
      if (!selected.includes(val)) selected.push(val);
    } else {
      selected = selected.filter((x) => x !== val);
    }
    store.set("createGroupForm.selectedUserIds", selected);
  },

  async submitCreateGroup() {
    const name = (store.get("createGroupForm.name") || "").trim();
    if (!name) {
      ToastService.show("Please enter a group name.", "warning");
      return;
    }

    const memberIds = store.get("createGroupForm.selectedUserIds") || [];
    if (memberIds.length < 2) {
      ToastService.show("A group must have at least 3 members (you + 2 others).", "warning");
      return;
    }

    try {
      const result = await wsClient.request("group.create", { name, memberIds });
      hideModal("createGroupModal");

      setActiveDestination("group", result.room.id);

      await loadInitialData();

      ToastService.show(`Group "${name}" created successfully!`, "success");
    } catch (err) {
      console.error("Group creation failed:", err);
    }
  },

  async openGroupMembers() {
    const dest = store.get("activeDest");
    if (!dest || dest.type !== "group") return;

    try {
      const result = await wsClient.request("group.members", { groupId: dest.value });
      const currentUser = store.get("session.user");
      const groups = store.get("groupList") || [];
      const currentGroup = groups.find((g) => g.id === dest.value);

      const members = result.members.map((m) => {
        const summary = MAPPERS.userSummary(m);
        const isOwner = currentGroup?.ownerId === m.id;
        const isSelf = currentUser.id === m.id;
        const canKick = currentGroup?.ownerId === currentUser.id && !isSelf;
        return { ...summary, isPremium: !!m.isPremium, isOwner, canKick };
      });

      const resolvedDms = store.get("resolvedDms") || [];
      const potential = resolvedDms.filter((d) => !result.members.some((m) => m.id === d.id));

      store.set("groupMembersForm", {
        members,
        canAddMembers: result.members.some((m) => m.id === currentUser.id),
        addableUsers: potential,
      });

      const select = document.getElementById("newGroupMemberSelect");
      if (select) {
        select.innerHTML = "";
        for (const u of potential) {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = `@${u.username} (${u.displayName})`;
          select.appendChild(opt);
        }
      }

      showModal("groupMembersModal");
    } catch (err) {
      console.error("Open group members failed:", err);
    }
  },

  async kickGroupMember(e, el) {
    e.stopPropagation();
    const dest = store.get("activeDest");
    const userId = el.getAttribute("data-user-id");
    if (!userId) return;

    try {
      await wsClient.request("group.removeMember", { groupId: dest.value, userId });
      ToastService.show("Member kicked out.", "info");
      await loadInitialData();
      await handlers.openGroupMembers();
    } catch (err) {
      console.error("Kick member failed:", err);
    }
  },

  async submitAddGroupMember() {
    const dest = store.get("activeDest");
    const select = document.getElementById("newGroupMemberSelect");
    const userId = select ? select.value : "";
    if (!userId) return;

    try {
      await wsClient.request("group.addMember", { groupId: dest.value, userId });
      ToastService.show("Member added successfully!", "success");
      await loadInitialData();
      await handlers.openGroupMembers();
    } catch (err) {
      console.error("Add member failed:", err);
    }
  },

  async leaveGroup() {
    const dest = store.get("activeDest");
    try {
      await wsClient.request("group.leave", { groupId: dest.value });
      ToastService.show("You left the group.", "info");

      hideModal("groupMembersModal");

      setActiveDestination("channel", "general");

      await loadInitialData();
    } catch (err) {
      console.error("Leave group failed:", err);
    }
  },

  viewUserProfileFromGroup(e, el) {
    if (e?.target?.closest?.(".kick-member-btn")) return;
    const userId = el.getAttribute("data-user-id");
    hideModal("groupMembersModal");

    setTimeout(() => openUserProfileById(userId), 300);
  },

  toggleEmojiPicker() {
    const popover = document.getElementById("emojiPopoverContainer");
    if (!popover) return;

    const pickerVisible = popover.classList.contains("mobile-docked") ||
      popover.classList.contains("desktop-compose") ||
      popover.classList.contains("desktop-reaction");
    const isReaction = popover.getAttribute("data-purpose") === "reaction";

    if (pickerVisible && !isReaction) {
      popover.className = "emoji-picker-popover";
    } else {
      popover.style.top = "";
      popover.style.left = "";
      popover.style.bottom = "";
      popover.style.right = "";

      popover.setAttribute("data-purpose", "compose");
      popover.removeAttribute("data-target-msg-id");

      if (window.innerWidth <= 1024) {
        popover.className = "emoji-picker-popover mobile-docked";
      } else {
        popover.className = "emoji-picker-popover desktop-compose";
      }
      ensureEmojiPickerMounted();
    }
  },
};

// Set onAuthLoss hook
onAuthLoss((message, toastType) => {
  wsClient.disconnect();
  setActiveDestination("channel", "general");
  handlers.showSignInTab();
  if (message) {
    ToastService.show(message, toastType);
  }
});
