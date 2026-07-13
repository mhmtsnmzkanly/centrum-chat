import { mount } from "./lime-csr.js";
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

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Mount the control-center template
  const appRoot = document.getElementById("control-center-app");
  if (appRoot) {
    mount("control-center", {}, appRoot, controlCenterStore, { handlers });
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

  // 3. Load operator profile details
  await controlCenterStore.loadOperator();

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
});
