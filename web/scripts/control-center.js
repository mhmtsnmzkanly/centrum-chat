import { mount, setDevMode } from "./lime-csr.js";
import { controlCenterStore } from "./control-center-store.js";
import { initShell, shellHandlers } from "./control-center-shell.js";
import { initNavigation, navigationHandlers } from "./control-center-navigation.js";
import { initModerationModule, moderationHandlers } from "./control-center-moderation.js";
import { initUsersModule, usersHandlers } from "./control-center-users.js";
import { initChannelsModule, channelsHandlers } from "./control-center-channels.js";
import { initRolesModule, rolesHandlers } from "./control-center-roles.js";
import { initSettingsModule, settingsHandlers } from "./control-center-settings.js";
import { initAuditModule, auditHandlers } from "./control-center-audit.js";
import { initOwnerModule, ownerHandlers } from "./control-center-owner.js";
import { initDialogs } from "./control-center-dialogs.js";
import {
  authPageUrl,
  guardProtectedPage,
  resolveControlCenterAccess,
} from "./shared-auth.js";

setDevMode(false);

const handlers = {
  ...shellHandlers,
  ...navigationHandlers,
  ...moderationHandlers,
  ...usersHandlers,
  ...channelsHandlers,
  ...rolesHandlers,
  ...settingsHandlers,
  ...auditHandlers,
  ...ownerHandlers,
};

// Static sidebar configuration rendered by tpl-cc-sidebar. Visibility and
// active state stay reactive through showNavGroup*/showTab_*/navClass_*
// store computeds; this array only describes structure, icons, and labels.
const NAV_GROUPS = [
  {
    id: "moderation",
    title: "Moderation",
    showPath: "showNavGroupModeration",
    items: [
      { tab: "reports", icon: "bi-chat-left-text", label: "Reports Queue" },
      { tab: "moderation-audit", icon: "bi-journal-text", label: "Moderation Audit" },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    showPath: "showNavGroupAdministration",
    items: [
      { tab: "users", icon: "bi-people", label: "Users" },
      { tab: "channels", icon: "bi-hash", label: "Channels" },
      { tab: "roles", icon: "bi-person-badge", label: "Roles" },
      { tab: "settings", icon: "bi-sliders", label: "System Settings" },
      { tab: "security-audit", icon: "bi-file-earmark-lock", label: "Security Audit" },
    ],
  },
  {
    id: "owner",
    title: "Owner Only",
    showPath: "showNavGroupOwner",
    items: [
      { tab: "ownership-transfer", icon: "bi-key", label: "Ownership Transfer" },
    ],
  },
];

async function initializeControlCenter() {
  const account = await guardProtectedPage("/control-center");
  if (!account) return;
  // Missing or unresolvable Control Center permission never renders an
  // in-page denied state: the auth page owns the permission-denied view
  // (auth.js finishDestination re-checks access for /control-center).
  const access = await resolveControlCenterAccess().catch(() => null);
  if (!access?.allowed) {
    window.location.replace(authPageUrl("/control-center"));
    return;
  }

  // Losing permission mid-session (a 403 makes the store clear its state and
  // flag accessDenied) routes through the same auth-page view.
  controlCenterStore.subscribe("accessDenied", (denied) => {
    if (denied) window.location.replace(authPageUrl("/control-center"));
  });

  // 1. Mount the control-center template
  const appRoot = document.getElementById("control-center-app");
  if (appRoot) {
    mount("control-center", {
      target: appRoot,
      context: { navGroups: NAV_GROUPS },
      store: controlCenterStore,
      handlers,
    });
  }

  // 2. Initialize UI modules
  initShell();
  initNavigation();
  initModerationModule();
  initUsersModule();
  initChannelsModule();
  initRolesModule();
  initSettingsModule();
  initAuditModule();
  initOwnerModule();
  initDialogs();

  // 3. Seed operator/capability state from the payload the access check
  //    already resolved — /api/control-center/me is fetched exactly once.
  controlCenterStore.applyOperator(access.operator);

  // 4. Trigger initial data loads if access is permitted
  const state = controlCenterStore.getState();
  if (!state.accessDenied) {
    await controlCenterStore.loadReports();

    const caps = state.capabilities;
    if (caps) {
      if (caps.administration.usersList) {
        await controlCenterStore.loadUsers();
      }
      if (caps.administration.channelsList) {
        await controlCenterStore.loadChannels();
      }
      if (caps.administration.settingsRead) {
        await controlCenterStore.loadSettings();
      }
      if (caps.moderation.auditList) {
        await controlCenterStore.loadAuditEvents();
      }
    }
  }

  // 5. Hide loading overlay
  const loader = document.getElementById("app-loading-screen");
  if (loader) {
    loader.style.opacity = "0";
    loader.style.visibility = "hidden";
    setTimeout(() => loader.remove(), 400);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeControlCenter, { once: true });
} else {
  void initializeControlCenter();
}
