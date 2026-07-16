import { controlCenterStore } from "./control-center-store.js";

export function initNavigation() {
  const sidebar = document.querySelector(".sidebar-aside");
  const mobileOpen = document.getElementById("btn-mobile-sidebar-open");
  const backdrop = document.getElementById("sidebar-backdrop");

  const reportsPanelRow = document.getElementById("reports-panel-row");
  const usersPanelRow = document.getElementById("users-panel-row");
  const btnReportsBack = document.getElementById("btn-reports-back-to-list");
  const btnUsersBack = document.getElementById("btn-users-back-to-list");

  function openSidebar() {
    sidebar?.classList.add("mobile-open");
    backdrop?.classList.add("active");
    mobileOpen?.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebar?.classList.remove("mobile-open");
    backdrop?.classList.remove("active");
    mobileOpen?.setAttribute("aria-expanded", "false");
  }

  mobileOpen?.addEventListener("click", openSidebar);
  backdrop?.addEventListener("click", closeSidebar);

  function showDetail(panelRow, backBtn) {
    if (window.matchMedia("(max-width: 767.98px)").matches) {
      panelRow?.classList.add("mobile-detail-active");
      backBtn?.classList.remove("d-none");
      backBtn?.classList.add("d-inline-flex");
    }
  }

  function showList(panelRow, backBtn) {
    panelRow?.classList.remove("mobile-detail-active");
    backBtn?.classList.add("d-none");
    backBtn?.classList.remove("d-inline-flex");
  }

  btnReportsBack?.addEventListener("click", () => {
    showList(reportsPanelRow, btnReportsBack);
  });

  btnUsersBack?.addEventListener("click", () => {
    showList(usersPanelRow, btnUsersBack);
  });

  window._ccMobileShowReportDetail = () => showDetail(reportsPanelRow, btnReportsBack);
  window._ccMobileShowUserDetail = () => showDetail(usersPanelRow, btnUsersBack);
  window._ccMobileCloseSidebar = closeSidebar;
}

export const navigationHandlers = {
  clickTab(e, el) {
    const tab = el.getAttribute("data-tab");
    if (tab) {
      controlCenterStore.update({ currentTab: tab });
      // Audit data is otherwise loaded once at boot; opening an audit tab
      // refreshes it so actions taken during this session show up without
      // requiring a filter change or a full reload.
      if (tab === "moderation-audit" || tab === "security-audit") {
        controlCenterStore.loadAuditEvents();
      }
      window._ccMobileCloseSidebar?.();
    }
  }
};
