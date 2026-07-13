import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

export function initSettingsModule() {
  // Navigation / template bindings handle everything state-driven.
}

export const settingsHandlers = {
  async submitSettingsForm(e, el) {
    const state = controlCenterStore.getState();
    const settings = state.settings || [];
    const settingsState = state.settingsState || {};
    const renderedVersions = state.renderedVersions || {};

    const changes = settings.filter((descriptor) => {
      const allowed = state.operator?.permissions?.includes(descriptor.permission);
      const val = settingsState[descriptor.key];
      return allowed && val !== descriptor.value;
    }).map((descriptor) => ({
      key: descriptor.key,
      expectedVersion: renderedVersions[descriptor.key] ?? descriptor.version,
      value: settingsState[descriptor.key],
    }));

    if (changes.length === 0) return;
    const button = document.getElementById("btn-save-settings");
    if (button) button.disabled = true;
    try {
      await controlCenterStore.updateSettings(changes);
      renderToast("success", "System settings updated successfully.");
    } catch (error) {
      if (error.status === 409) {
        await controlCenterStore.loadSettings();
        renderToast(
          "warning",
          "A setting changed concurrently. Current versions were loaded; review and resubmit your changes.",
        );
      } else {
        renderToast("danger", `Failed to save settings: ${error.message}`);
      }
    } finally {
      if (button) button.disabled = false;
    }
  },

  changeMaintenanceMode(e, el) {
    if (el.checked) {
      const accepted = globalThis.confirm(
        "Maintenance mode blocks normal mutations while preserving reads, health, heartbeat, recovery, moderation, and authorized administration. Continue?",
      );
      if (!accepted) {
        el.checked = false;
        controlCenterStore.set("settingsState.maintenance_mode", false);
      }
    }
  }
};
