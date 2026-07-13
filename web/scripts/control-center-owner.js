import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

export function initOwnerModule() {
  const targetSelect = document.getElementById("owner-target-user");
  const confirmInput = document.getElementById("owner-confirm-text");
  const btnSubmit = document.getElementById("btn-confirm-transfer-ownership");

  function validateForm() {
    const isTargetSelected = !!targetSelect.value;
    const isConfirmed = confirmInput.value === "TRANSFER";
    btnSubmit.disabled = !(isTargetSelected && isConfirmed);
  }

  targetSelect?.addEventListener("change", validateForm);
  confirmInput?.addEventListener("input", validateForm);

  btnSubmit?.addEventListener("click", async () => {
    const targetUserId = targetSelect.value;
    if (!targetUserId || confirmInput.value !== "TRANSFER") return;

    btnSubmit.disabled = true;
    try {
      const target = controlCenterStore.getState().users.find((user) =>
        user.id === targetUserId
      );
      await controlCenterStore.transferOwnership(targetUserId, target.role);
      renderToast(
        "success",
        "System ownership successfully transferred. Your account is now demoted to Administrator.",
      );

      // Reset inputs
      targetSelect.value = "";
      confirmInput.value = "";
      btnSubmit.disabled = true;

      // Switch to reports tab as owner-only tabs are now forbidden
      controlCenterStore.update({ currentTab: "reports" });
    } catch (err) {
      renderToast("danger", `Failed to transfer ownership: ${err.message}`);
      btnSubmit.disabled = false;
    }
  });

  // Subscribe to store updates to populate select dropdown
  controlCenterStore.subscribe((state) => {
    const op = state.operator;
    if (!state.capabilities?.owner.ownershipTransfer) return;

    const currentSelected = targetSelect.value;
    targetSelect.textContent = "";

    const optDefault = document.createElement("option");
    optDefault.value = "";
    optDefault.textContent = "Select a user...";
    targetSelect.appendChild(optDefault);

    // Only allow promoting users that are not already owner or self
    state.users.forEach((user) => {
      if (user.id !== op.id && user.role === "admin") {
        const opt = document.createElement("option");
        opt.value = user.id;
        opt.textContent = `${
          user.displayName || user.username
        } (${user.role.toUpperCase()})`;
        targetSelect.appendChild(opt);
      }
    });

    if (currentSelected && state.users.some((u) => u.id === currentSelected)) {
      targetSelect.value = currentSelected;
    }
  });
}
