import { controlCenterStore } from "./control-center-store.js";
import { renderToast } from "./control-center-common.js";

export function initModerationModule() {
  // Navigation / template bindings handle everything state-driven.
}

export const moderationHandlers = {
  updateReportsFilter() {
    controlCenterStore.loadReports();
  },

  loadMoreReports() {
    const state = controlCenterStore.getState();
    if (state.nextReportsCursor) {
      controlCenterStore.loadReports(state.nextReportsCursor, true);
    }
  },

  async selectReport(e, el) {
    const id = el.getAttribute("data-id");
    await controlCenterStore.loadReportDetails(id);
    window._ccMobileShowReportDetail?.();
  },

  async assignReportToMe(e, el) {
    const id = el.getAttribute("data-id") ||
      controlCenterStore.getState().selectedReportId;
    const state = controlCenterStore.getState();
    const rep = state.reports.find(r => r.id === id) || state.selectedReportDetails;
    if (rep && state.operator) {
      try {
        await controlCenterStore.assignReport(id, rep.assignedModeratorId, state.operator.id);
        renderToast("success", "Report assigned to you.");
      } catch (err) {
        renderToast("danger", `Assignment failed: ${err.message}`);
      }
    }
  },

  async startReviewReport(e, el) {
    const id = el.getAttribute("data-id") ||
      controlCenterStore.getState().selectedReportId;
    try {
      await controlCenterStore.transitionReport(id, "open", "in_review");
      renderToast("success", "Review started.");
    } catch (err) {
      renderToast("danger", `Failed: ${err.message}`);
    }
  },

  async returnOpenReport(e, el) {
    const id = el.getAttribute("data-id") ||
      controlCenterStore.getState().selectedReportId;
    try {
      await controlCenterStore.transitionReport(id, "in_review", "open");
      renderToast("success", "Report returned to open queue.");
    } catch (err) {
      renderToast("danger", `Failed: ${err.message}`);
    }
  },

  async resolveReport(e, el) {
    const id = el.getAttribute("data-id") ||
      controlCenterStore.getState().selectedReportId;
    try {
      await controlCenterStore.transitionReport(id, "in_review", "resolved");
      renderToast("success", "Report resolved.");
    } catch (err) {
      renderToast("danger", `Failed: ${err.message}`);
    }
  },

  async dismissReport(e, el) {
    const id = el.getAttribute("data-id") ||
      controlCenterStore.getState().selectedReportId;
    const state = controlCenterStore.getState();
    const rep = state.reports.find(r => r.id === id) || state.selectedReportDetails;
    if (rep) {
      try {
        await controlCenterStore.transitionReport(id, rep.status, "dismissed");
        renderToast("success", "Report dismissed.");
      } catch (err) {
        renderToast("danger", `Failed: ${err.message}`);
      }
    }
  },

  clickApplySanction(e, el) {
    const state = controlCenterStore.getState();
    const rep = state.selectedReportDetails;
    const targetId = rep ? (rep.targetType === "user" ? rep.targetId : null) : null;
    if (targetId) {
      document.getElementById("sanction-target-user-id").value = targetId;
      document.getElementById("sanction-target-user-display").value = targetId;
      document.getElementById("sanction-notes").value = "";
      
      const modalEl = document.getElementById("dialog-apply-sanction");
      if (modalEl) {
        const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
        modal?.show();
      }
    }
  },

  clickRevokeSanction(e, el) {
    const id = el.getAttribute("data-id");
    const userId = el.getAttribute("data-user-id");
    document.getElementById("revoke-sanction-id").value = id;
    document.getElementById("revoke-sanction-user-id").value = userId;
    document.getElementById("revoke-reason-input").value = "";
    
    const modalEl = document.getElementById("dialog-revoke-sanction");
    if (modalEl) {
      const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
      modal?.show();
    }
  },

  async submitApplySanctionForm(e, el) {
    const userId = document.getElementById("sanction-target-user-id").value;
    const type = document.getElementById("sanction-type").value;
    const reasonCode = document.getElementById("sanction-reason").value;
    const moderatorNote = document.getElementById("sanction-notes").value.trim();
    const duration = document.getElementById("sanction-duration").value;
    const expiresAt = duration === "permanent"
      ? null
      : new Date(Date.now() + Number(duration) * 1000).toISOString();
    try {
      await controlCenterStore.applySanction(userId, {
        type,
        reasonCode,
        moderatorNote,
        ...(expiresAt ? { expiresAt } : {}),
      });
      renderToast("success", "Sanction applied.");
      const modalEl = document.getElementById("dialog-apply-sanction");
      if (modalEl) {
        window.bootstrap?.Modal?.getInstance(modalEl)?.hide();
      }
    } catch (error) {
      renderToast("danger", `Sanction failed: ${error.message}`);
    }
  },

  async submitRevokeSanctionForm(e, el) {
    const sanctionId = document.getElementById("revoke-sanction-id").value;
    const userId = document.getElementById("revoke-sanction-user-id").value;
    const reason = document.getElementById("revoke-reason-input").value.trim();
    try {
      await controlCenterStore.revokeSanction(sanctionId, userId, reason);
      renderToast("success", "Sanction revoked.");
      const modalEl = document.getElementById("dialog-revoke-sanction");
      if (modalEl) {
        window.bootstrap?.Modal?.getInstance(modalEl)?.hide();
      }
    } catch (error) {
      if (error.status === 409) {
        await controlCenterStore.loadUserSanctions(userId);
      }
      renderToast("danger", `Revocation failed: ${error.message}`);
    }
  }
};
