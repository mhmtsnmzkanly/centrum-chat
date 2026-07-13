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
