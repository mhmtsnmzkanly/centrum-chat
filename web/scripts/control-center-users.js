import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";
import { confirmAction } from "./control-center-dialogs.js";

export function initUsersModule() {
  // Navigation / template bindings handle everything state-driven.
}

let searchTimeout = null;

export const usersHandlers = {
  async selectUser(e, el) {
    const id = el.getAttribute("data-id");
    await controlCenterStore.loadUserDetails(id);
    window._ccMobileShowUserDetail?.();
  },

  updateUsersFilter() {
    const searchVal = document.getElementById("search-users")?.value || "";
    const roleVal = document.getElementById("filter-user-role")?.value || "";
    controlCenterStore.update({
      usersFilters: {
        search: searchVal,
        role: roleVal,
      }
    });
    controlCenterStore.loadUsers();
  },

  updateUsersFilterDebounced() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      usersHandlers.updateUsersFilter();
    }, 300);
  },

  loadMoreUsers() {
    const state = controlCenterStore.getState();
    if (state.nextUsersCursor) {
      controlCenterStore.loadUsers(state.nextUsersCursor, true);
    }
  },

  async submitUpdateUserForm(e, el) {
    const user = controlCenterStore.getState().selectedUserDetails;
    if (!user) return;
    const displayName = document.getElementById("edit-user-display-name").value.trim();
    const bio = document.getElementById("edit-user-bio").value.trim();
    const disabled = document.getElementById("edit-user-disabled").checked;
    
    const patch = {
      ...(displayName === user.displayName ? {} : { displayName }),
      ...(bio === user.bio ? {} : { bio }),
      ...(disabled === !!user.accountDisabledAt ? {} : { disabled }),
    };
    if (Object.keys(patch).length === 0) return;
    try {
      await controlCenterStore.updateUser(user.id, user.version, patch);
      renderToast("success", "User profile updated.");
    } catch (error) {
      if (error.status === 409) {
        await controlCenterStore.loadUserDetails(user.id);
      }
      renderToast("danger", `Update failed: ${error.message}`);
    }
  },

  revokeUserSessionsBtn(e, el) {
    const user = controlCenterStore.getState().selectedUserDetails;
    if (!user) return;
    confirmAction(
      `Revoke every refresh session for @${user.username}? Short-lived stateless access tokens may remain valid until expiry, but runtime account policy still applies.`,
      async () => {
        await controlCenterStore.revokeUserSessions(user.id);
        renderToast("success", `Successfully revoked all sessions for @${user.username}`);
      }
    );
  },

  forcePasswordResetBtn(e, el) {
    const user = controlCenterStore.getState().selectedUserDetails;
    if (!user) return;
    confirmAction(
      `Force @${user.username} to complete password recovery? Refresh sessions are revoked and normal mutations remain blocked until reset completion.`,
      async () => {
        await controlCenterStore.forcePasswordReset(user.id);
        renderToast("success", `Successfully queued password reset requirements for @${user.username}`);
      }
    );
  },

  resetUserAvatarBtn(e, el) {
    const user = controlCenterStore.getState().selectedUserDetails;
    if (!user) return;
    confirmAction(
      `Remove custom avatar profile image for @${user.username}?`,
      async () => {
        await controlCenterStore.resetUserAvatar(user.id);
        renderToast("success", `Avatar reset for @${user.username}`);
      }
    );
  },

  resetUserCoverBtn(e, el) {
    const user = controlCenterStore.getState().selectedUserDetails;
    if (!user) return;
    confirmAction(
      `Remove custom profile cover image for @${user.username}?`,
      async () => {
        await controlCenterStore.resetUserCover(user.id);
        renderToast("success", `Cover image reset for @${user.username}`);
      }
    );
  }
};
