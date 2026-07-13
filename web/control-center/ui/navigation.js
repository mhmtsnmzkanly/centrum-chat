import { controlCenterStore } from "../state/store.js";

export function initNavigation() {
  const sidebar = document.querySelector(".sidebar-aside");
  const mobileToggle = document.getElementById("btn-sidebar-mobile-toggle");
  const mobileOpen = document.getElementById("btn-mobile-sidebar-open");
  const backdrop = document.getElementById("sidebar-backdrop");
  const navBtns = document.querySelectorAll(".btn-sidebar");
  const panels = document.querySelectorAll(".tab-panel");
  const workspaceTitle = document.getElementById("workspace-title");

  const navGroupMod = document.getElementById("nav-group-moderation");
  const navGroupAdmin = document.getElementById("nav-group-administration");
  const navGroupOwner = document.getElementById("nav-group-owner");
  const contractBanner = document.getElementById("contract-unavailable-banner");
  const tabPermission = {
    reports: (caps) => caps.moderation.reportsList,
    "moderation-audit": (caps) => caps.moderation.auditList,
    users: (caps) => caps.administration.usersList,
    channels: (caps) => caps.administration.channelsList,
    roles: (caps) => caps.administration.rolesView,
    settings: (caps) => caps.administration.settingsRead,
    "security-audit": (caps) => caps.administration.securityAuditList,
    "ownership-transfer": (caps) => caps.owner.ownershipTransfer,
  };

  // ── Sidebar helpers ────────────────────────────────────────────────────────
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

  // Mobile hamburger (in top workspace bar)
  mobileOpen?.addEventListener("click", openSidebar);

  // Old toggle button (kept for backward compat)
  mobileToggle?.addEventListener("click", () => {
    sidebar?.classList.contains("mobile-open") ? closeSidebar() : openSidebar();
  });

  // Click outside sidebar (backdrop) → close
  backdrop?.addEventListener("click", closeSidebar);

  // ── Mobile two-column detail/list toggling ─────────────────────────────────
  const reportsPanelRow = document.getElementById("reports-panel-row");
  const usersPanelRow = document.getElementById("users-panel-row");
  const btnReportsBack = document.getElementById("btn-reports-back-to-list");
  const btnUsersBack = document.getElementById("btn-users-back-to-list");

  function isMobile() {
    return window.matchMedia("(max-width: 767.98px)").matches;
  }

  function showDetail(panelRow, backBtn) {
    if (isMobile()) {
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

  // Expose helpers so report/user detail modules can trigger them
  window._ccMobileShowReportDetail = () =>
    showDetail(reportsPanelRow, btnReportsBack);
  window._ccMobileShowUserDetail = () =>
    showDetail(usersPanelRow, btnUsersBack);

  function resetMobilePanels() {
    showList(reportsPanelRow, btnReportsBack);
    showList(usersPanelRow, btnUsersBack);
  }

  // Navigation tab clicks
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) {
        resetMobilePanels();
        controlCenterStore.update({ currentTab: tab });
        closeSidebar(); // auto-close on mobile
      }
    });
  });

  // Subscribe to store updates
  controlCenterStore.subscribe((state) => {
    const { currentTab, capabilities } = state;

    // 1. Dynamic capability-based navigation group display
    if (capabilities) {
      const showMod = Object.values(capabilities.moderation).some((v) =>
        v === true
      );
      const showAdmin = Object.values(capabilities.administration).some((v) =>
        v === true
      );
      const showOwner = Object.values(capabilities.owner).some((v) =>
        v === true
      );

      if (navGroupMod) navGroupMod.classList.toggle("d-none", !showMod);
      if (navGroupAdmin) navGroupAdmin.classList.toggle("d-none", !showAdmin);
      if (navGroupOwner) navGroupOwner.classList.toggle("d-none", !showOwner);

      if (contractBanner) contractBanner.classList.add("d-none");
      navBtns.forEach((button) => {
        const tab = button.getAttribute("data-tab");
        const allowed = tab && tabPermission[tab]?.(capabilities);
        button.closest("li")?.classList.toggle("d-none", !allowed);
      });
      if (!tabPermission[currentTab]?.(capabilities)) {
        const firstAllowed = Object.keys(tabPermission).find((tab) =>
          tabPermission[tab](capabilities)
        );
        if (firstAllowed) {
          controlCenterStore.update({ currentTab: firstAllowed });
          return;
        }
      }
    }

    // 2. Tab panels toggle
    panels.forEach((panel) => {
      const panelId = panel.id;
      const expectedId = `panel-${currentTab}`;
      panel.classList.toggle("d-none", panelId !== expectedId);
    });

    // 3. Navigation buttons active styling
    navBtns.forEach((btn) => {
      const tab = btn.getAttribute("data-tab");
      const isActive = tab === currentTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });

    // 4. Update Header Title
    if (workspaceTitle) {
      const titles = {
        reports: "Reports Queue",
        "moderation-audit": "Moderation Audit Logs",
        users: "Users Administration",
        channels: "Channels Configuration",
        roles: "Roles Transition Gating",
        settings: "Global System Settings",
        "security-audit": "Security Audit Trail",
        "ownership-transfer": "System Ownership Transfer",
      };
      workspaceTitle.textContent = titles[currentTab] || "Novastrum Console";
    }
  });
}
