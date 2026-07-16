import {
  canAccessControlCenterTab,
  getAllowedControlCenterTabs,
  isKnownControlCenterTab,
} from "./control-center-contract.js";
import { controlCenterStore } from "./control-center-store.js";

export function readRequestedControlCenterTab() {
  const value = new URL(window.location.href).searchParams.get("tab");
  return isKnownControlCenterTab(value) ? value : null;
}

export function reconcileControlCenterTab(requestedTab = null) {
  const capabilities = controlCenterStore.get("capabilities");
  const allowedTabs = getAllowedControlCenterTabs(capabilities);
  if (allowedTabs.length === 0) return null;

  const currentTab = controlCenterStore.get("currentTab");
  const nextTab = requestedTab && allowedTabs.includes(requestedTab)
    ? requestedTab
    : (allowedTabs.includes(currentTab) ? currentTab : allowedTabs[0]);
  controlCenterStore.set("currentTab", nextTab);
  return nextTab;
}

function replaceTabInUrl(tab) {
  if (!isKnownControlCenterTab(tab)) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("tab") === tab) return;
  url.searchParams.set("tab", tab);
  window.history.replaceState({ controlCenterTab: tab }, "", url);
}

function activateTab(tab) {
  const capabilities = controlCenterStore.get("capabilities");
  if (!canAccessControlCenterTab(capabilities, tab)) return;

  controlCenterStore.set("currentTab", tab);
  if (tab === "moderation-audit" || tab === "security-audit") {
    void controlCenterStore.loadAuditEvents();
  }
  window._ccMobileCloseSidebar?.();
}

function moveTabFocus(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(
    document.querySelectorAll(
      '.sidebar-nav-container [data-show^="showNav_"]:not([hidden]) [data-tab]',
    ),
  );
  if (buttons.length === 0) return;

  const currentIndex = buttons.indexOf(event.target.closest("[data-tab]"));
  if (currentIndex < 0) return;
  event.preventDefault();

  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % buttons.length;
  }
  if (event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  }
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = buttons.length - 1;
  buttons[nextIndex].focus();
}

export function initNavigation() {
  const sidebar = document.querySelector(".sidebar-aside");
  const mobileOpen = document.getElementById("btn-mobile-sidebar-open");
  const backdrop = document.getElementById("sidebar-backdrop");
  const sidebarNav = document.querySelector(".sidebar-nav-container");

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
  sidebarNav?.addEventListener("keydown", moveTabFocus);

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

  controlCenterStore.subscribe("capabilities", () => {
    const nextTab = reconcileControlCenterTab();
    if (!nextTab && !controlCenterStore.get("accessDenied")) {
      controlCenterStore.clearSensitiveState();
    }
  });
  controlCenterStore.subscribe("currentTab", (tab) => replaceTabInUrl(tab));

  window._ccMobileShowReportDetail = () =>
    showDetail(reportsPanelRow, btnReportsBack);
  window._ccMobileShowUserDetail = () =>
    showDetail(usersPanelRow, btnUsersBack);
  window._ccMobileCloseSidebar = closeSidebar;

  replaceTabInUrl(controlCenterStore.get("currentTab"));
}

export const navigationHandlers = {
  clickTab(_event, element) {
    activateTab(element.getAttribute("data-tab"));
  },
};
