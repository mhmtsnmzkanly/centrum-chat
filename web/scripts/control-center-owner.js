import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function initOwnerModule() {
  controlCenterStore.subscribe((state) => {
    const targetSelect = document.getElementById("owner-target-user");
    if (!targetSelect) return;
    const op = state.operator;
    if (!state.capabilities?.owner.ownershipTransfer) return;

    const currentSelected = targetSelect.value;
    targetSelect.textContent = "";
    targetSelect.appendChild(option("", "Select a user..."));

    // Only allow promoting users that are not already owner or self and are admins
    state.users.forEach((user) => {
      const isUserAdmin = user.system_role === "admin" || user.role === "admin";
      if (user.id !== op.id && isUserAdmin) {
        targetSelect.appendChild(option(
          user.id,
          `${user.displayName || user.username} (ADMIN)`
        ));
      }
    });

    if (currentSelected && state.users.some((u) => u.id === currentSelected)) {
      targetSelect.value = currentSelected;
    }
  });
}

export const ownerHandlers = {
  validateOwnerTransferForm() {
    const targetSelect = document.getElementById("owner-target-user");
    const confirmInput = document.getElementById("owner-confirm-text");
    const btnSubmit = document.getElementById("btn-confirm-transfer-ownership");
    if (targetSelect && confirmInput && btnSubmit) {
      const isTargetSelected = !!targetSelect.value;
      const isConfirmed = confirmInput.value === "TRANSFER";
      btnSubmit.disabled = !(isTargetSelected && isConfirmed);
    }
  },

  async submitTransferOwnership() {
    const targetSelect = document.getElementById("owner-target-user");
    const confirmInput = document.getElementById("owner-confirm-text");
    const btnSubmit = document.getElementById("btn-confirm-transfer-ownership");
    if (!targetSelect || !confirmInput || !btnSubmit) return;
    
    const targetUserId = targetSelect.value;
    if (!targetUserId || confirmInput.value !== "TRANSFER") return;

    btnSubmit.disabled = true;
    try {
      const target = controlCenterStore.getState().users.find((user) =>
        user.id === targetUserId
      );
      const role = target.system_role || target.role;
      await controlCenterStore.transferOwnership(targetUserId, role);
      renderToast(
        "success",
        "System ownership successfully transferred. Your account is now demoted to Administrator.",
      );

      targetSelect.value = "";
      confirmInput.value = "";
      btnSubmit.disabled = true;

      controlCenterStore.update({ currentTab: "reports" });
    } catch (err) {
      renderToast("danger", `Failed to transfer ownership: ${err.message}`);
      btnSubmit.disabled = false;
    }
  }
};
