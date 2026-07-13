import { controlCenterStore } from "./control-center-store.js";
import { el, renderToast } from "./control-center-common.js";

export function initChannelsModule() {
  const tableRows = document.getElementById("channels-table-rows");
  const loadingPlaceholder = document.getElementById(
    "channels-loading-placeholder",
  );

  const btnOpenCreate = document.getElementById("btn-open-create-channel");

  const createForm = document.getElementById("create-channel-form");
  const editForm = document.getElementById("edit-channel-form");

  // Create Channel submission
  createForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = document.getElementById("create-chan-slug").value.trim();
    const name = document.getElementById("create-chan-name").value.trim();
    const description = document.getElementById("create-chan-desc").value
      .trim();

    const btnSubmit = document.getElementById("btn-confirm-create-channel");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await controlCenterStore.createChannel({ slug, name, description });
      renderToast("success", `Channel #${slug} created successfully.`);

      const bootstrap = (globalThis.window || globalThis).bootstrap;
      const modalEl = document.getElementById("dialog-create-channel");
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal?.hide();
    } catch (err) {
      renderToast("danger", `Failed to create channel: ${err.message}`);
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Edit Channel submission (Optimistic concurrency version check)
  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-chan-id").value;
    const expectedVersion = Number(
      document.getElementById("edit-chan-version").value,
    );
    const name = document.getElementById("edit-chan-name").value.trim();
    const description = document.getElementById("edit-chan-desc").value.trim();

    const btnSubmit = document.getElementById("btn-confirm-edit-channel");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const current = controlCenterStore.getState().channels.find((item) =>
        item.id === id
      );
      const patch = {
        ...(current?.name === name ? {} : { name }),
        ...(current?.description === description ? {} : { description }),
      };
      if (Object.keys(patch).length === 0) return;
      await controlCenterStore.updateChannel(id, expectedVersion, patch);
      renderToast("success", `Channel updated successfully.`);

      const bootstrap = (globalThis.window || globalThis).bootstrap;
      const modalEl = document.getElementById("dialog-edit-channel");
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal?.hide();
    } catch (err) {
      if (err.code === "CONFLICT" || err.status === 409) {
        // Handle version mismatch: reload state and explain to user
        renderToast(
          "warning",
          "Conflict detected: The channel details have been updated by another operator. Reloading current state...",
        );
        // Auto-refresh channel in store and keep modal open, updating only version field while preserving user edits!
        await controlCenterStore.loadChannels();
        const fresh = controlCenterStore.getState().channels.find((c) =>
          c.id === id
        );
        if (fresh) {
          document.getElementById("edit-chan-version").value = fresh.version;
        }
      } else {
        renderToast("danger", `Failed to update channel: ${err.message}`);
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  btnOpenCreate?.addEventListener("click", () => {
    document.getElementById("create-chan-name").value = "";
    document.getElementById("create-chan-slug").value = "";
    document.getElementById("create-chan-desc").value = "";

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    const modalEl = document.getElementById("dialog-create-channel");
    if (bootstrap && bootstrap.Modal) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  });

  // Subscribe to store updates
  controlCenterStore.subscribe((state) => {
    if (state.channelsLoading && state.channels.length === 0) {
      tableRows.textContent = "";
      loadingPlaceholder?.classList.remove("d-none");
    } else {
      loadingPlaceholder?.classList.add("d-none");
      tableRows.textContent = "";

      state.channels.forEach((chan) => {
        const isArchived = chan.state === "archived";
        const statusBadge = el("span", {
          className: `badge ${
            isArchived
              ? "bg-secondary"
              : "bg-success-subtle text-success border border-success-subtle"
          }`,
          textContent: isArchived ? "Archived" : "Active",
        });

        const row = el("tr", {}, [
          el("td", {
            className: "font-monospace fs-8 text-muted",
            textContent: chan.id,
          }),
          el("td", {
            className: "fw-semibold text-dark-mode-override",
            textContent: `#${chan.name}`,
          }),
          el("td", {
            className: "text-truncate text-muted max-w-500",
            textContent: chan.description || "No description.",
          }),
          el("td", {
            className: "fs-8 text-muted",
            textContent: `v${chan.version}`,
          }),
          el("td", {}, [statusBadge]),
          el("td", { className: "text-end" }, [
            el("div", { className: "d-flex gap-2 justify-content-end" }, [
              el("button", {
                className: "btn btn-xs btn-outline-secondary py-1 px-2 fs-8",
                textContent: "Edit",
                onclick: () => openEditModal(chan),
              }),
              isArchived
                ? el("button", {
                  className: "btn btn-xs btn-outline-success py-1 px-2 fs-8",
                  textContent: "Restore",
                  disabled: state.pendingActions[`restore-channel-${chan.id}`],
                  onclick: () =>
                    controlCenterStore.restoreChannel(chan.id, chan.version),
                })
                : el("button", {
                  className: "btn btn-xs btn-outline-danger py-1 px-2 fs-8",
                  textContent: "Archive",
                  disabled: state.pendingActions[`archive-channel-${chan.id}`],
                  onclick: async () => {
                    try {
                      await controlCenterStore.archiveChannel(
                        chan.id,
                        chan.version,
                      );
                    } catch (error) {
                      const message =
                        error.serverCode === "SETTING_VALIDATION_FAILED"
                          ? "The configured default channel cannot be archived."
                          : error.message;
                      renderToast("danger", message);
                      await controlCenterStore.loadChannels();
                      await controlCenterStore.loadSettings();
                    }
                  },
                }),
            ]),
          ]),
        ]);
        tableRows.appendChild(row);
      });
    }
  });
}

function openEditModal(channel) {
  const modalEl = document.getElementById("dialog-edit-channel");
  const idInput = document.getElementById("edit-chan-id");
  const versionInput = document.getElementById("edit-chan-version");
  const nameInput = document.getElementById("edit-chan-name");
  const descInput = document.getElementById("edit-chan-desc");

  if (modalEl && idInput && versionInput && nameInput && descInput) {
    idInput.value = channel.id;
    versionInput.value = channel.version;
    nameInput.value = channel.name;
    descInput.value = channel.description || "";

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    if (bootstrap && bootstrap.Modal) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }
}
