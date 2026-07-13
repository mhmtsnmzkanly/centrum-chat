import { controlCenterStore } from "./state/store.js";
import { initShell } from "./ui/shell.js";
import { initNavigation } from "./ui/navigation.js";
import { initModerationModule } from "./ui/moderation.js";
import { initUsersModule } from "./ui/users.js";
import { initChannelsModule } from "./ui/channels.js";
import { initRolesModule } from "./ui/roles.js";
import { initSettingsModule } from "./ui/settings.js";
import { initAuditModule } from "./ui/audit.js";
import { initOwnerModule } from "./ui/owner.js";
import { initDialogs } from "./ui/dialogs.js";

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize UI modules
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

  // 2. Load operator profile details
  await controlCenterStore.loadOperator();

  // 3. Trigger initial data loads if access is permitted
  const state = controlCenterStore.getState();
  if (!state.accessDenied) {
    await controlCenterStore.loadReports();

    // Check capabilities before executing admin fetches in production
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

  // 4. Hide full-screen loading overlay once initial rendering completes
  const loader = document.getElementById("app-loading-screen");
  if (loader) {
    loader.style.opacity = "0";
    loader.style.visibility = "hidden";
    setTimeout(() => loader.remove(), 400);
  }
});
