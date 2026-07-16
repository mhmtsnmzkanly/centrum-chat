import { controlCenterStore } from "./control-center-store.js";

const TAB_RULES = [
  {
    id: "reports",
    allowed: (caps) => caps?.moderation?.reportsList,
  },
  {
    id: "moderation-audit",
    allowed: (caps) => caps?.moderation?.auditList,
  },
  {
    id: "users",
    allowed: (caps) => caps?.administration?.usersList,
  },
  {
    id: "channels",
    allowed: (caps) => caps?.administration?.channelsList,
  },
  {
    id: "roles",
    allowed: (caps) => caps?.administration?.rolesView,
  },
  {
    id: "settings",
    allowed: (caps) => caps?.administration?.settingsRead,
  },
  {
    id: "security-audit",
    allowed: (caps) => caps?.administration?.securityAuditList,
  },
  {
    id: "ownership-transfer",
    allowed: (caps) => caps?.owner?.ownershipTransfer,
  },
];

const TAB_IDS = new Set(TAB_RULES.map((tab) => tab.id));
let requestedTab = readRequestedTab();

function readRequestedTab() {
  const value = new URL(window.location.href).searchParams.get("tab");
  return value && TAB_IDS.has(value) ? value : null;
}

function allowedTabs() {
  const capabilities = controlCenterStore.get("capabilities");
  return TAB_RULES.filter((tab) => !!tab.allowed(capabilities));
}

function replaceTabInUrl(tab) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tab") === tab) return;
  url.searchParams.set("tab", tab);
  window.history.replaceState({ controlCenterTab: tab }, "", url);
}

function syncNavigationVisibility() {
  const allowed = new Set(allowedTabs().map((tab) => tab.id));

  for (const item of document.querySelectorAll("[data-nav-item]")) {
    item.hidden = !allowed.has(item.getAttribute("data-nav-item"));
  }

  for (const group of document.querySelectorAll("[data-nav-group]")) {
    const hasVisibleItem = Array.from(
      group.querySelectorAll("[data-nav-item]"),
    ).some((item) => !item.hidden);
    group.hidden = !hasVisibleItem;
  }
}

function renderActiveTab() {
  const permitted = allowedTabs();
  if (permitted.length === 0) {
    for (const panel of document.querySelectorAll("[data-panel]")) {
      panel.hidden = true;
    }
    return;
  }

  const permittedIds = new Set(permitted.map((tab) => tab.id));
  const current = controlCenterStore.get("currentTab");
  const next = permittedIds.has(requestedTab)
    ? requestedTab
    : (permittedIds.has(current) ? current : permitted[0].id);
  requestedTab = null;

  if (current !== next) {
    controlCenterStore.set("currentTab", next);
    return;
  }

  for (const panel of document.querySelectorAll("[data-panel]")) {
    const active = panel.getAttribute("data-panel") === next;
    panel.hidden = !active;
    panel.setAttribute("aria-hidden", String(!active));
  }

  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.getAttribute("data-tab") === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("tabindex", active ? "0" : "-1");
  }

  replaceTabInUrl(next);
}

function activateTab(tab) {
  if (!TAB_IDS.has(tab)) return;
  const permitted = allowedTabs().some((item) => item.id === tab);
  if (!permitted) return;

  controlCenterStore.set("currentTab", tab);
  if (tab === "moderation-audit" || tab === "security-audit") {
    void controlCenterStore.loadAuditEvents();
  }
  window._ccMobileCloseSidebar?.();
}

function moveTabFocus(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(
    document.querySelectorAll("[data-nav-item]:not([hidden]) [data-tab]"),
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

  window.addEventListener("popstate", () => {
    requestedTab = readRequestedTab();
    renderActiveTab();
  });
  controlCenterStore.subscribe("capabilities", () => {
    syncNavigationVisibility();
    renderActiveTab();
  });
  controlCenterStore.subscribe("currentTab", renderActiveTab);

  window._ccMobileShowReportDetail = () =>
    showDetail(reportsPanelRow, btnReportsBack);
  window._ccMobileShowUserDetail = () =>
    showDetail(usersPanelRow, btnUsersBack);
  window._ccMobileCloseSidebar = closeSidebar;

  syncNavigationVisibility();
  renderActiveTab();
}

export const navigationHandlers = {
  clickTab(_event, element) {
    activateTab(element.getAttribute("data-tab"));
  },
};
