import { controlCenterStore } from "./control-center-store.js";

export function initAuditModule() {
  // Navigation / template bindings handle everything state-driven.
}

let modTimeout = null;
let secTimeout = null;

export const auditHandlers = {
  updateModAuditFilter() {
    clearTimeout(modTimeout);
    modTimeout = setTimeout(() => {
      const actorVal = document.getElementById("mod-audit-actor-id")?.value.trim() || "";
      const targetVal = document.getElementById("mod-audit-target-id")?.value.trim() || "";
      controlCenterStore.update({
        auditFilters: {
          actionCode: "",
          actorUserId: actorVal,
          targetType: "",
          targetId: targetVal,
        },
      });
      controlCenterStore.loadAuditEvents();
    }, 300);
  },

  clearModAuditFilters() {
    const actorInput = document.getElementById("mod-audit-actor-id");
    const targetInput = document.getElementById("mod-audit-target-id");
    if (actorInput) actorInput.value = "";
    if (targetInput) targetInput.value = "";
    auditHandlers.updateModAuditFilter();
  },

  updateSecAuditFilter() {
    clearTimeout(secTimeout);
    secTimeout = setTimeout(() => {
      const actorVal = document.getElementById("sec-audit-actor-id")?.value.trim() || "";
      const actionVal = document.getElementById("sec-audit-action-code")?.value.trim() || "";
      controlCenterStore.update({
        auditFilters: {
          actionCode: actionVal,
          actorUserId: actorVal,
          targetType: "",
          targetId: "",
        },
      });
      controlCenterStore.loadAuditEvents();
    }, 300);
  },

  clearSecAuditFilters() {
    const actorInput = document.getElementById("sec-audit-actor-id");
    const actionInput = document.getElementById("sec-audit-action-code");
    if (actorInput) actorInput.value = "";
    if (actionInput) actionInput.value = "";
    auditHandlers.updateSecAuditFilter();
  },

  loadMoreModAudit() {
    const state = controlCenterStore.getState();
    if (state.nextAuditCursor) {
      controlCenterStore.loadAuditEvents(state.nextAuditCursor, true);
    }
  },

  loadMoreSecAudit() {
    const state = controlCenterStore.getState();
    if (state.nextAuditCursor) {
      controlCenterStore.loadAuditEvents(state.nextAuditCursor, true);
    }
  },

  toggleAuditMeta(e, el) {
    const id = el.getAttribute("data-id");
    const pre = document.getElementById(`meta-${id}`);
    if (pre) {
      const isHidden = pre.classList.toggle("d-none");
      el.textContent = isHidden ? "Show Details" : "Hide Details";
    }
  }
};
