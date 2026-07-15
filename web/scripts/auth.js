import {
  authenticatedFetch,
  getAuthEpoch,
  logoutBrowserSession,
  resolveAuthenticatedAccount,
  resolveControlCenterAccess,
  resolveReturnTo,
  TokenStorage,
} from "./shared-auth.js";
import { createAuthTranslator } from "./auth-i18n.js";

const VIEWS = new Set([
  "resolving-session", "sign-in", "register-account", "onboarding-preferences",
  "verification-required", "password-reset-request", "password-reset-complete",
  "permission-denied", "redirecting", "fatal-error",
]);
const AVATARS = ["Felix", "Max", "Luna", "Cleo", "Oliver", "Milo", "Leo", "Lucy"];
const COVERS = [0, 1, 2, 3, 4, 5];
const FIELD_IDS = {
  username: "register-username", displayName: "register-display-name", email: "register-email",
  password: "sign-in-password", bio: "onboarding-bio", avatarSeed: "onboarding-avatar",
  coverIndex: "onboarding-cover", nameColor: "onboarding-color",
};

const locale = navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
const i18n = createAuthTranslator(locale);
document.documentElement.lang = i18n.locale;
for (const element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = i18n.text(element.dataset.i18n);
}

const url = new URL(window.location.href);
const returnTo = resolveReturnTo(url.searchParams.get("returnTo"), "/");
const securityTokens = {
  verification: url.searchParams.get("verify_email"),
  passwordReset: url.searchParams.get("reset_password"),
  emailChange: url.searchParams.get("change_email"),
};
for (const key of ["verify_email", "reset_password", "change_email"]) url.searchParams.delete(key);
url.searchParams.set("returnTo", returnTo);
history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);

let currentView = "resolving-session";
let transitionId = 0;
let pending = false;
let accountStatus = null;
const captcha = { config: null, tokens: {}, widgets: {} };

function transition(view, options = {}) {
  if (!VIEWS.has(view)) throw new Error(`Unknown auth view: ${view}`);
  const previousView = currentView;
  transitionId += 1;
  currentView = view;
  if (previousView === "sign-in" && view !== previousView) {
    document.getElementById("sign-in-password").value = "";
  }
  if (previousView === "register-account" && view !== previousView) {
    document.getElementById("register-password").value = "";
  }
  if (previousView === "password-reset-complete" && view !== previousView) {
    securityTokens.passwordReset = null;
  }
  clearErrors();
  for (const section of document.querySelectorAll("[data-auth-view]")) {
    section.hidden = section.dataset.authView !== view;
  }
  const nav = document.getElementById("auth-nav");
  nav.hidden = !["sign-in", "register-account", "password-reset-request"].includes(view);
  for (const button of nav.querySelectorAll("button")) {
    const active = (view === "sign-in" && button.dataset.action === "show-sign-in") ||
      (view === "register-account" && button.dataset.action === "show-register");
    button.toggleAttribute("aria-current", active);
  }
  if (options.status) setStatus(options.status);
  const heading = document.querySelector(`[data-auth-view="${view}"] h2`);
  if (options.focus !== false) heading?.focus();
  if (view !== "password-reset-complete") clearResetPasswords();
}

function setStatus(message = "") {
  document.getElementById("status-region").textContent = message;
}

function clearErrors() {
  const summary = document.getElementById("error-summary");
  summary.hidden = true;
  summary.textContent = "";
  for (const input of document.querySelectorAll("[aria-invalid='true']")) input.removeAttribute("aria-invalid");
  for (const error of document.querySelectorAll(".field-error")) error.textContent = "";
}

function showError(error, fallback = i18n.text("errors.generic")) {
  const message = error?.message || fallback;
  const summary = document.getElementById("error-summary");
  summary.textContent = message;
  summary.hidden = false;
  const field = error?.details?.field;
  const input = document.getElementById(FIELD_IDS[field] || "");
  if (input) {
    input.setAttribute("aria-invalid", "true");
    const fieldError = document.getElementById(`${input.id}-error`);
    if (fieldError) fieldError.textContent = message;
    input.focus();
  } else {
    summary.focus();
  }
}

function showValidationError(form) {
  const firstInvalid = form.querySelector(":invalid");
  const summary = document.getElementById("error-summary");
  summary.textContent = i18n.text("errors.required");
  summary.hidden = false;
  if (firstInvalid) {
    firstInvalid.setAttribute("aria-invalid", "true");
    firstInvalid.focus();
  } else {
    summary.focus();
  }
}

function setPending(form, value) {
  pending = value;
  for (const control of form?.querySelectorAll("button, input, select, textarea") || []) {
    control.disabled = value;
  }
}

async function requestJson(path, options = {}, authenticated = false) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = authenticated
    ? await authenticatedFetch(path, { ...options, headers })
    : await fetch(path, { ...options, headers });
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.success) {
    const error = new Error(envelope?.error?.message || i18n.text("errors.generic"));
    error.code = envelope?.error?.code || "INTERNAL_ERROR";
    error.details = envelope?.error?.details;
    error.status = response.status;
    throw error;
  }
  return envelope.data;
}

async function initializeCaptcha() {
  try {
    const config = await requestJson("/api/config/public");
    captcha.config = config.captcha;
    if (captcha.config?.provider !== "turnstile" || !captcha.config.siteKey) return;
    const render = () => {
      if (!window.turnstile) return setTimeout(render, 200);
      for (const [action, id] of Object.entries({ register: "captcha-register", login: "captcha-login", password_reset: "captcha-password-reset" })) {
        const element = document.getElementById(id);
        if (!element || captcha.widgets[action] !== undefined) continue;
        captcha.widgets[action] = window.turnstile.render(element, {
          sitekey: captcha.config.siteKey, action,
          callback: (token) => captcha.tokens[action] = token,
          "expired-callback": () => captcha.tokens[action] = null,
          "error-callback": () => captcha.tokens[action] = null,
        });
      }
    };
    render();
  } catch (error) {
    console.warn("Public auth configuration unavailable:", error);
  }
}

function consumeCaptcha(action) {
  const token = captcha.tokens[action] || null;
  captcha.tokens[action] = null;
  const widget = captcha.widgets[action];
  if (widget !== undefined && window.turnstile) window.turnstile.reset(widget);
  return token;
}

function fillPreferences(status) {
  const profile = status.profile || {};
  const preferences = status.preferences || {};
  document.getElementById("onboarding-bio").value = profile.bio || "";
  document.getElementById("onboarding-avatar").value = profile.avatarSeed || AVATARS[0];
  document.getElementById("onboarding-cover").value = String(profile.coverIndex || 0);
  document.getElementById("onboarding-color").value = profile.nameColor || "#0284c7";
  document.getElementById("onboarding-theme").value = preferences.theme || "dark";
  document.getElementById("onboarding-dm-privacy").value = preferences.dmPrivacy || "everyone";
  document.getElementById("onboarding-group-privacy").value = preferences.groupPrivacy || "everyone";
  document.getElementById("onboarding-sound").checked = preferences.sound !== false;
  document.getElementById("onboarding-notifications").checked = !!preferences.desktopNotifications;
}

async function finishDestination() {
  if (returnTo.startsWith("/control-center")) {
    const access = await resolveControlCenterAccess();
    if (!access.allowed) {
      transition("permission-denied");
      return;
    }
  }
  transition("redirecting");
  window.location.replace(returnTo);
}

async function resolveSession() {
  transition("resolving-session", { focus: false });
  if (!TokenStorage.get()) {
    transition("sign-in");
    return;
  }
  let status;
  try {
    status = await resolveAuthenticatedAccount();
    accountStatus = status;
  } catch (error) {
    TokenStorage.clear();
    transition("sign-in");
    showError(error, i18n.text("errors.session"));
    return;
  }
  if (securityTokens.emailChange) {
    try {
      await requestJson("/api/auth/email-change/complete", {
        method: "POST", body: JSON.stringify({ token: securityTokens.emailChange }),
      }, true);
      securityTokens.emailChange = null;
      setStatus(i18n.text("status.emailChanged"));
    } catch (error) {
      securityTokens.emailChange = null;
      transition("fatal-error");
      document.getElementById("fatal-message").textContent = error.message;
      return;
    }
  }
  if (status.currentOnboardingStep === "preferences") {
    fillPreferences(status);
    transition("onboarding-preferences");
    return;
  }
  if (status.currentOnboardingStep === "email-verification") {
    document.getElementById("verification-email").textContent = status.email;
    transition("verification-required");
    return;
  }
  try {
    await finishDestination();
  } catch (error) {
    transition("fatal-error");
    document.getElementById("fatal-message").textContent = error.message;
  }
}

async function completeVerificationToken() {
  if (!securityTokens.verification) return;
  try {
    await requestJson("/api/auth/verify-email/complete", {
      method: "POST", body: JSON.stringify({ token: securityTokens.verification }),
    });
    securityTokens.verification = null;
    setStatus(i18n.text("status.emailVerified"));
  } catch (error) {
    securityTokens.verification = null;
    transition("fatal-error");
    document.getElementById("fatal-message").textContent = error.message;
  }
}

for (const seed of AVATARS) document.getElementById("onboarding-avatar").add(new Option(seed, seed));
for (const index of COVERS) {
  document.getElementById("onboarding-cover").add(
    new Option(i18n.text("options.cover", { number: index + 1 }), String(index)),
  );
}

document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-password-toggle]");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    toggle.setAttribute("aria-pressed", String(!visible));
    toggle.textContent = i18n.text(visible ? "actions.showPassword" : "actions.hidePassword");
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  const action = actionButton?.dataset.action;
  if (!action || pending) return;
  if (action === "show-sign-in") transition("sign-in");
  if (action === "show-register") transition("register-account");
  if (action === "show-reset-request") transition("password-reset-request");
  if (action === "logout") {
    pending = true;
    actionButton.disabled = true;
    try {
      await logout();
    } finally {
      pending = false;
      actionButton.disabled = false;
    }
  }
  if (action === "check-verification") {
    pending = true;
    actionButton.disabled = true;
    try {
      await resolveSession();
    } finally {
      pending = false;
      actionButton.disabled = false;
    }
  }
  if (action === "resend-verification") {
    pending = true;
    actionButton.disabled = true;
    try {
      await requestJson("/api/auth/verify-email/resend", { method: "POST" }, true);
      setStatus(i18n.text("status.verificationSent"));
    } catch (error) { showError(error); }
    finally {
      pending = false;
      actionButton.disabled = false;
    }
  }
});

document.getElementById("sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending) return;
  if (!form.checkValidity()) return showValidationError(form);
  const requestId = ++transitionId;
  const epoch = getAuthEpoch();
  setPending(form, true);
  clearErrors();
  try {
    const data = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("sign-in-identity").value.trim(),
        password: document.getElementById("sign-in-password").value,
        rememberMe: document.getElementById("sign-in-remember").checked,
        deviceLabel: "Web browser",
        captchaToken: consumeCaptcha("login"),
      }),
    });
    if (requestId !== transitionId || epoch !== getAuthEpoch()) return;
    TokenStorage.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, document.getElementById("sign-in-remember").checked);
    document.getElementById("sign-in-password").value = "";
    await resolveSession();
  } catch (error) { if (requestId === transitionId) showError(error); }
  finally { setPending(form, false); }
});

document.getElementById("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending) return;
  if (!form.checkValidity()) return showValidationError(form);
  const requestId = ++transitionId;
  const epoch = getAuthEpoch();
  setPending(form, true);
  clearErrors();
  try {
    const rememberMe = document.getElementById("register-remember").checked;
    const data = await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("register-username").value.trim(),
        displayName: document.getElementById("register-display-name").value.trim(),
        email: document.getElementById("register-email").value.trim(),
        password: document.getElementById("register-password").value,
        rememberMe, deviceLabel: "Web browser", captchaToken: consumeCaptcha("register"),
      }),
    });
    if (requestId !== transitionId || epoch !== getAuthEpoch()) return;
    TokenStorage.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, rememberMe);
    document.getElementById("register-password").value = "";
    await resolveSession();
  } catch (error) { if (requestId === transitionId) showError(error); }
  finally { setPending(form, false); }
});

document.getElementById("preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending) return;
  if (!form.checkValidity()) return showValidationError(form);
  const requestId = ++transitionId;
  const epoch = getAuthEpoch();
  setPending(form, true);
  clearErrors();
  try {
    const status = await requestJson("/api/auth/onboarding/preferences", {
      method: "POST",
      body: JSON.stringify({
        bio: document.getElementById("onboarding-bio").value.trim(),
        avatarSeed: document.getElementById("onboarding-avatar").value,
        coverIndex: Number(document.getElementById("onboarding-cover").value),
        nameColor: document.getElementById("onboarding-color").value,
        theme: document.getElementById("onboarding-theme").value,
        dmPrivacy: document.getElementById("onboarding-dm-privacy").value,
        groupPrivacy: document.getElementById("onboarding-group-privacy").value,
        sound: document.getElementById("onboarding-sound").checked,
        desktopNotifications: document.getElementById("onboarding-notifications").checked,
      }),
    }, true);
    if (requestId !== transitionId || epoch !== getAuthEpoch()) return;
    accountStatus = status;
    if (status.currentOnboardingStep === "email-verification") {
      document.getElementById("verification-email").textContent = status.email;
      transition("verification-required");
    } else await finishDestination();
  } catch (error) { if (requestId === transitionId) showError(error); }
  finally { setPending(form, false); }
});

document.getElementById("request-notification-permission").addEventListener("click", async () => {
  if (!("Notification" in window)) return setStatus(i18n.text("status.notificationDenied"));
  const result = await Notification.requestPermission();
  document.getElementById("onboarding-notifications").checked = result === "granted";
  setStatus(i18n.text(result === "granted" ? "status.notificationGranted" : "status.notificationDenied"));
});

document.getElementById("reset-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (pending) return;
  if (!form.checkValidity()) return showValidationError(form);
  setPending(form, true);
  try {
    await requestJson("/api/auth/password-reset/request", {
      method: "POST", body: JSON.stringify({ email: document.getElementById("reset-email").value.trim(), captchaToken: consumeCaptcha("password_reset") }),
    });
    transition("sign-in", { status: i18n.text("status.resetSent") });
  } catch (error) { showError(error); }
  finally { setPending(form, false); }
});

document.getElementById("reset-complete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = document.getElementById("reset-new-password").value;
  const confirmation = document.getElementById("reset-confirm-password").value;
  if (pending) return;
  if (!securityTokens.passwordReset || !form.checkValidity()) return showValidationError(form);
  if (password !== confirmation) return showError(null, i18n.text("errors.passwordMismatch"));
  setPending(form, true);
  try {
    await requestJson("/api/auth/password-reset/complete", {
      method: "POST", body: JSON.stringify({ token: securityTokens.passwordReset, newPassword: password }),
    });
    securityTokens.passwordReset = null;
    clearResetPasswords();
    TokenStorage.clear();
    transition("sign-in", { status: i18n.text("status.resetComplete") });
  } catch (error) { showError(error); }
  finally { setPending(form, false); }
});

function clearResetPasswords() {
  document.getElementById("reset-new-password").value = "";
  document.getElementById("reset-confirm-password").value = "";
}

async function logout() {
  try {
    await logoutBrowserSession();
  } catch {
    // Local credential removal is authoritative for this browser even if the network is down.
    TokenStorage.clear();
  }
  accountStatus = null;
  transition("sign-in");
}

await initializeCaptcha();
if (securityTokens.passwordReset) {
  transition("password-reset-complete");
} else {
  await completeVerificationToken();
  if (currentView !== "fatal-error") await resolveSession();
}
