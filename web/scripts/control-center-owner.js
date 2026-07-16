import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function syncOwnerTargetSelect() {
  const targetSelect = document.getElementById("owner-target-user");
  if (!targetSelect) return;
  const state = controlCenterStore.getState();
  const op = state.operator;
  if (!op || !state.capabilities?.owner.ownershipTransfer) return;

  const currentSelected = targetSelect.value;
  targetSelect.textContent = "";
  targetSelect.appendChild(option("", "Select a user..."));

  // Only allow promoting users that are not already owner or self and are admins
  state.users.forEach((user) => {
    if (user.id !== op.id && user.role === "admin") {
      targetSelect.appendChild(option(
        user.id,
        `${user.displayName || user.username} (ADMIN)`
      ));
    }
  });

  if (currentSelected && state.users.some((u) => u.id === currentSelected)) {
    targetSelect.value = currentSelected;
  }
}

export function initOwnerModule() {
  // Rebuild only when the data it renders actually changes — not on every
  // unrelated store update.
  for (const path of ["users", "capabilities", "operator"]) {
    controlCenterStore.subscribe(path, syncOwnerTargetSelect);
  }
  syncOwnerTargetSelect();
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
      const role = target.role;
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
