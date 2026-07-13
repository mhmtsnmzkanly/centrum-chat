import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

export function initChannelsModule() {
  // Navigation / template bindings handle everything state-driven.
}

export const channelsHandlers = {
  openCreateChannelModal() {
    document.getElementById("create-chan-name").value = "";
    document.getElementById("create-chan-slug").value = "";
    document.getElementById("create-chan-desc").value = "";
    const modalEl = document.getElementById("dialog-create-channel");
    if (modalEl) {
      const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
      modal?.show();
    }
  },

  async submitCreateChannelForm(e, el) {
    const slug = document.getElementById("create-chan-slug").value.trim();
    const name = document.getElementById("create-chan-name").value.trim();
    const description = document.getElementById("create-chan-desc").value.trim();
    
    const btnSubmit = document.getElementById("btn-confirm-create-channel");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await controlCenterStore.createChannel({ slug, name, description });
      renderToast("success", `Channel #${slug} created successfully.`);
      const modalEl = document.getElementById("dialog-create-channel");
      if (modalEl) {
        window.bootstrap?.Modal?.getInstance(modalEl)?.hide();
      }
    } catch (err) {
      renderToast("danger", `Failed to create channel: ${err.message}`);
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  },

  clickEditChannel(e, el) {
    const id = el.getAttribute("data-id");
    const chan = controlCenterStore.getState().channels.find(c => c.id === id);
    if (chan) {
      document.getElementById("edit-chan-id").value = chan.id;
      document.getElementById("edit-chan-version").value = chan.version;
      document.getElementById("edit-chan-name").value = chan.name;
      document.getElementById("edit-chan-desc").value = chan.description || "";
      const modalEl = document.getElementById("dialog-edit-channel");
      if (modalEl) {
        const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
        modal?.show();
      }
    }
  },

  async submitEditChannelForm(e, el) {
    const id = document.getElementById("edit-chan-id").value;
    const expectedVersion = Number(document.getElementById("edit-chan-version").value);
    const name = document.getElementById("edit-chan-name").value.trim();
    const description = document.getElementById("edit-chan-desc").value.trim();

    const btnSubmit = document.getElementById("btn-confirm-edit-channel");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const current = controlCenterStore.getState().channels.find((item) => item.id === id);
      const patch = {
        ...(current?.name === name ? {} : { name }),
        ...(current?.description === description ? {} : { description }),
      };
      if (Object.keys(patch).length === 0) return;
      await controlCenterStore.updateChannel(id, expectedVersion, patch);
      renderToast("success", `Channel updated successfully.`);
      const modalEl = document.getElementById("dialog-edit-channel");
      if (modalEl) {
        window.bootstrap?.Modal?.getInstance(modalEl)?.hide();
      }
    } catch (err) {
      if (err.code === "CONFLICT" || err.status === 409) {
        renderToast(
          "warning",
          "Conflict detected: The channel details have been updated by another operator. Reloading current state...",
        );
        await controlCenterStore.loadChannels();
        const fresh = controlCenterStore.getState().channels.find((c) => c.id === id);
        if (fresh) {
          document.getElementById("edit-chan-version").value = fresh.version;
        }
      } else {
        renderToast("danger", `Failed to update channel: ${err.message}`);
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  },

  async archiveChannelBtn(e, el) {
    const id = el.getAttribute("data-id");
    const chan = controlCenterStore.getState().channels.find(c => c.id === id);
    if (!chan) return;
    try {
      await controlCenterStore.archiveChannel(chan.id, chan.version);
      renderToast("success", "Channel archived.");
    } catch (error) {
      const message = error.serverCode === "SETTING_VALIDATION_FAILED"
        ? "The configured default channel cannot be archived."
        : error.message;
      renderToast("danger", message);
      await controlCenterStore.loadChannels();
      await controlCenterStore.loadSettings();
    }
  },

  async restoreChannelBtn(e, el) {
    const id = el.getAttribute("data-id");
    const chan = controlCenterStore.getState().channels.find(c => c.id === id);
    if (!chan) return;
    try {
      await controlCenterStore.restoreChannel(chan.id, chan.version);
      renderToast("success", "Channel restored.");
    } catch (error) {
      renderToast("danger", `Failed to restore: ${error.message}`);
    }
  }
};
