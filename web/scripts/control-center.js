import { mount, setDevMode, subscribeDiagnostics } from "./lime-csr.js";
import {
  bindBootActions,
  classifyControlCenterStartupError,
  CONTROL_CENTER_STARTUP_ERRORS,
  finishBoot,
  setBootStage,
  showBootError,
  startupError,
} from "./control-center-boot.js";
import { controlCenterStore } from "./control-center-store.js";
import { initShell, shellHandlers } from "./control-center-shell.js";
import {
  initNavigation,
  navigationHandlers,
  readRequestedControlCenterTab,
  reconcileControlCenterTab,
} from "./control-center-navigation.js";
import { initModerationModule, moderationHandlers } from "./control-center-moderation.js";
import { initUsersModule, usersHandlers } from "./control-center-users.js";
import { initChannelsModule, channelsHandlers } from "./control-center-channels.js";
import { initRolesModule, rolesHandlers } from "./control-center-roles.js";
import { initSettingsModule, settingsHandlers } from "./control-center-settings.js";
import { initAuditModule, auditHandlers } from "./control-center-audit.js";
import { initOwnerModule, ownerHandlers } from "./control-center-owner.js";
import { initDialogs } from "./control-center-dialogs.js";
import { renderToast } from "./control-center-common.js";
import {
  authPageUrl,
  resolveAuthenticatedAccount,
  resolveControlCenterAccess,
} from "./shared-auth.js";
import { restoreAccountLocale, saveAccountLocale } from "./account-locale.js";
import {
  bindLocaleSelect,
  getLocale,
  observeTranslations,
  subscribeLocale,
  t,
  translateDocument,
} from "./i18n.js";

setDevMode(false);

const handlers = {
  ...shellHandlers,
  ...navigationHandlers,
  ...moderationHandlers,
  ...usersHandlers,
  ...channelsHandlers,
  ...rolesHandlers,
  ...settingsHandlers,
  ...auditHandlers,
  ...ownerHandlers,
};

function navItem(tab, icon, label) {
  return {
    tab,
    icon,
    label,
    showPath: `showNav_${tab}`,
    navClassPath: `navClass_${tab}`,
    ariaSelectedPath: `navAriaSelected_${tab}`,
    tabIndexPath: `navTabIndex_${tab}`,
  };
}

const NAV_GROUPS = [
  {
    id: "moderation",
    title: "Moderation",
    showPath: "showNavGroup_moderation",
    items: [
      navItem("reports", "bi-chat-left-text", "Reports Queue"),
      navItem("moderation-audit", "bi-journal-text", "Moderation Audit"),
    ],
  },
  {
    id: "administration",
    title: "Administration",
    showPath: "showNavGroup_administration",
    items: [
      navItem("users", "bi-people", "Users"),
      navItem("channels", "bi-hash", "Channels"),
      navItem("roles", "bi-person-badge", "Roles"),
      navItem("settings", "bi-sliders", "System Settings"),
      navItem("security-audit", "bi-file-earmark-lock", "Security Audit"),
    ],
  },
  {
    id: "owner",
    title: "Owner Only",
    showPath: "showNavGroup_owner",
    items: [
      navItem("ownership-transfer", "bi-key", "Ownership Transfer"),
    ],
  },
];

const BLOCKING_LIME_DIAGNOSTICS = new Set([
  "MOUNT_TEMPLATE_NOT_FOUND",
  "TEMPLATE_NOT_FOUND",
  "PARTIAL_NOT_FOUND",
  "PARTIAL_DEPTH_LIMIT",
  "PIPELINE_DEPTH_LIMIT",
  "HANDLER_NOT_FOUND",
]);
const MAX_STARTUP_DIAGNOSTICS = 20;

function beginStartupDiagnostics() {
  const diagnostics = [];
  const unsubscribe = subscribeDiagnostics((diagnostic) => {
    if (diagnostics.length < MAX_STARTUP_DIAGNOSTICS) diagnostics.push(diagnostic);
  });
  return { diagnostics, unsubscribe };
}

function assertNoBlockingLimeDiagnostics(diagnostics) {
  const diagnostic = [...diagnostics].reverse().find((item) =>
    BLOCKING_LIME_DIAGNOSTICS.has(item.code)
  );
  if (diagnostic) {
    throw startupError(
      CONTROL_CENTER_STARTUP_ERRORS.LIME,
      diagnostic,
      diagnostic.code,
    );
  }
}

function redirectToAuth() {
  window.location.replace(authPageUrl("/control-center"));
}

async function resolveProtectedSession() {
  try {
    const account = await resolveAuthenticatedAccount();
    if (!account.onboardingComplete) {
      redirectToAuth();
      return null;
    }
    return account;
  } catch (error) {
    if (error?.status === 401 || error?.code === "UNAUTHORIZED") {
      redirectToAuth();
      return null;
    }
    throw startupError(CONTROL_CENTER_STARTUP_ERRORS.SESSION, error);
  }
}

async function resolveOperatorAccess() {
  try {
    return await resolveControlCenterAccess();
  } catch (error) {
    if (error?.status === 401 || error?.code === "UNAUTHORIZED") {
      redirectToAuth();
      return null;
    }
    throw startupError(CONTROL_CENTER_STARTUP_ERRORS.PERMISSIONS, error);
  }
}

function mountControlCenter() {
  const appRoot = document.getElementById("control-center-app");
  if (!appRoot) {
    throw startupError(CONTROL_CENTER_STARTUP_ERRORS.LIME, null, "MOUNT_TARGET_NOT_FOUND");
  }
  mount("control-center", {
    target: appRoot,
    context: { navGroups: NAV_GROUPS },
    store: controlCenterStore,
    handlers,
  });
  translateDocument(appRoot);
}

function initializeControlCenterModules() {
  initShell();
  initNavigation();
  initModerationModule();
  initUsersModule();
  initChannelsModule();
  initRolesModule();
  initSettingsModule();
  initAuditModule();
  initOwnerModule();
  initDialogs();
  observeTranslations();
  subscribeLocale((locale) => {
    controlCenterStore.set("locale", locale);
    queueMicrotask(() => translateDocument());
  });
  bindLocaleSelect(document.getElementById("control-locale-select"), async (locale) => {
    try {
      await saveAccountLocale(locale);
    } catch {
      renderToast("danger", t("language.saveFailed"));
    }
  });
}

async function loadInitialControlCenterData() {
  const capabilities = controlCenterStore.get("capabilities");
  const loads = [];
  if (capabilities?.moderation?.reportsList) {
    loads.push({ errorPath: "reportsError", promise: controlCenterStore.loadReports() });
  }
  if (capabilities?.administration?.usersList) {
    loads.push({ errorPath: "usersError", promise: controlCenterStore.loadUsers() });
  }
  if (capabilities?.administration?.channelsList) {
    loads.push({ errorPath: "channelsError", promise: controlCenterStore.loadChannels() });
  }
  if (capabilities?.administration?.settingsRead) {
    loads.push({ errorPath: "settingsError", promise: controlCenterStore.loadSettings() });
  }
  if (capabilities?.moderation?.auditList) {
    loads.push({ errorPath: "auditError", promise: controlCenterStore.loadAuditEvents() });
  }

  await Promise.all(loads.map((load) => load.promise));
  const failed = loads.find((load) => controlCenterStore.get(load.errorPath));
  if (failed) {
    throw startupError(
      CONTROL_CENTER_STARTUP_ERRORS.INITIAL_DATA,
      controlCenterStore.get(failed.errorPath),
    );
  }
}

async function initializeControlCenter() {
  let unsubscribeDiagnostics = () => {};
  bindBootActions();

  try {
    setBootStage("SESSION");
    const account = await resolveProtectedSession();
    if (!account) return;

    setBootStage("LOCALE");
    try {
      await restoreAccountLocale();
    } catch (error) {
      throw startupError(CONTROL_CENTER_STARTUP_ERRORS.LOCALE, error);
    }
    translateDocument();
    controlCenterStore.set("locale", getLocale());

    setBootStage("PERMISSIONS");
    const access = await resolveOperatorAccess();
    if (!access) return;
    if (!access.allowed) {
      redirectToAuth();
      return;
    }

    controlCenterStore.subscribe("accessDenied", (denied) => {
      if (denied) redirectToAuth();
    });
    controlCenterStore.applyOperator(access.operator);
    const initialTab = reconcileControlCenterTab(readRequestedControlCenterTab());
    if (!initialTab) {
      redirectToAuth();
      return;
    }

    setBootStage("RENDER");
    const startupDiagnostics = beginStartupDiagnostics();
    unsubscribeDiagnostics = startupDiagnostics.unsubscribe;
    try {
      mountControlCenter();
      assertNoBlockingLimeDiagnostics(startupDiagnostics.diagnostics);
      initializeControlCenterModules();
      assertNoBlockingLimeDiagnostics(startupDiagnostics.diagnostics);
    } catch (error) {
      if (error?.code === CONTROL_CENTER_STARTUP_ERRORS.LIME) throw error;
      throw startupError(CONTROL_CENTER_STARTUP_ERRORS.LIME, error);
    }

    setBootStage("INITIAL_DATA");
    await loadInitialControlCenterData();
    assertNoBlockingLimeDiagnostics(startupDiagnostics.diagnostics);

    setBootStage("READY");
    finishBoot();
  } catch (error) {
    const startupFailure = classifyControlCenterStartupError(error);
    console.error("Control Center initialization failed", error);
    showBootError(startupFailure);
  } finally {
    unsubscribeDiagnostics();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeControlCenter, { once: true });
} else {
  void initializeControlCenter();
}
