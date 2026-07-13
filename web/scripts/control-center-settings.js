import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

const FIELD_IDS = Object.freeze({
  registration_enabled: "setting-registration-enabled",
  email_verification_required: "setting-verification-required",
  maintenance_mode: "setting-maintenance-mode",
  max_message_length: "setting-max-message",
  max_group_members: "setting-max-group-members",
  max_upload_size_bytes: "setting-upload-limit",
  max_avatar_size_bytes: "setting-avatar-limit",
  max_cover_size_bytes: "setting-cover-limit",
  allow_group_creation: "setting-allow-groups",
  allow_new_dm: "setting-allow-dms",
  default_channel_id: "setting-default-channel",
});

function fieldValue(descriptor) {
  const field = document.getElementById(FIELD_IDS[descriptor.key]);
  if (descriptor.type === "boolean") return field.checked;
  if (descriptor.type === "integer") return Number(field.value);
  return field.value.trim();
}

function writeField(descriptor, value = descriptor.value) {
  const field = document.getElementById(FIELD_IDS[descriptor.key]);
  if (!field) return;
  if (descriptor.type === "boolean") field.checked = !!value;
  else field.value = value;
  const allowed = controlCenterStore.getState().operator?.permissions?.includes(
    descriptor.permission,
  );
  field.disabled = !allowed;
}

export function initSettingsModule() {
  const form = document.getElementById("settings-form");
  let renderedVersions = new Map();
  let conflictDraft = null;

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = controlCenterStore.getState().settings || [];
    const changes = settings.filter((descriptor) =>
      controlCenterStore.getState().operator?.permissions?.includes(
        descriptor.permission,
      ) &&
      fieldValue(descriptor) !== descriptor.value
    ).map((descriptor) => ({
      key: descriptor.key,
      expectedVersion: renderedVersions.get(descriptor.key) ??
        descriptor.version,
      value: fieldValue(descriptor),
    }));
    if (changes.length === 0) return;
    const button = document.getElementById("btn-save-settings");
    button.disabled = true;
    try {
      await controlCenterStore.updateSettings(changes);
      renderToast("success", "System settings updated successfully.");
    } catch (error) {
      if (error.status === 409) {
        conflictDraft = Object.fromEntries(settings.map((item) => [
          item.key,
          fieldValue(item),
        ]));
        await controlCenterStore.loadSettings();
        renderToast(
          "warning",
          "A setting changed concurrently. Current versions were loaded; review and resubmit your retained values.",
        );
      } else {
        renderToast("danger", `Failed to save settings: ${error.message}`);
      }
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("setting-maintenance-mode")?.addEventListener(
    "change",
    (event) => {
      if (event.target.checked) {
        const accepted = globalThis.confirm(
          "Maintenance mode blocks normal mutations while preserving reads, health, heartbeat, recovery, moderation, and authorized administration. Continue?",
        );
        if (!accepted) event.target.checked = false;
      }
    },
  );

  controlCenterStore.subscribe((state) => {
    if (!Array.isArray(state.settings)) return;
    renderedVersions = new Map(
      state.settings.map((item) => [item.key, item.version]),
    );
    for (const descriptor of state.settings) {
      writeField(
        descriptor,
        conflictDraft?.[descriptor.key] ?? descriptor.value,
      );
    }
    conflictDraft = null;
  });
}
