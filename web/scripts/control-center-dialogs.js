import { renderToast } from "./control-center-common.js";

export function initDialogs() {
  const modals = [
    "dialog-apply-sanction",
    "dialog-revoke-sanction",
    "dialog-create-channel",
    "dialog-edit-channel",
    "dialog-confirm-action",
  ];

  let triggerElement = null;

  modals.forEach((modalId) => {
    const el = document.getElementById(modalId);
    if (!el) return;

    el.addEventListener("show.bs.modal", (e) => {
      triggerElement = e.relatedTarget || document.activeElement;
    });

    el.addEventListener("hidden.bs.modal", () => {
      if (triggerElement && typeof triggerElement.focus === "function") {
        triggerElement.focus();
      }
      triggerElement = null;
    });
  });
}

export function confirmAction(message, action) {
  const modalEl = document.getElementById("dialog-confirm-action");
  const bodyText = document.getElementById("confirm-action-body");
  const btnConfirm = document.getElementById("btn-confirm-action-submit");

  if (modalEl && bodyText && btnConfirm) {
    bodyText.textContent = message;

    // Remove previous click handlers
    const clonedConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(clonedConfirm, btnConfirm);

    clonedConfirm.addEventListener("click", async () => {
      const bootstrap = (globalThis.window || globalThis).bootstrap;
      const modal = bootstrap.Modal.getInstance(modalEl);
      modal?.hide();
      try {
        await action();
      } catch (err) {
        renderToast("danger", `Action failed: ${err.message}`);
      }
    });

    const bootstrap = (globalThis.window || globalThis).bootstrap;
    if (bootstrap && bootstrap.Modal) {
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    }
  }
}
