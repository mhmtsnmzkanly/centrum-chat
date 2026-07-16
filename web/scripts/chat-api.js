import { store } from "./chat-store.js";
import { clearAuthenticatedState } from "./chat-auth.js";
import { authenticatedFetch } from "./shared-auth.js";
import { localizeError, t, translateSourceText } from "./i18n.js";

export const ToastService = {
  show: (message, type = "info") => {
    const toastId = "toast_" + Math.random().toString(36).slice(2, 7);
    const iconMap = {
      success: "bi-check-circle-fill text-success",
      error: "bi-exclamation-triangle-fill text-danger",
      warning: "bi-exclamation-circle-fill text-warning",
      info: "bi-info-circle-fill text-primary",
    };

    const toastHtml = `
      <div id="${toastId}" class="toast toast-custom hide" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="toast-header border-0 bg-transparent">
          <i class="bi ${iconMap[type]} me-2"></i>
      <strong class="me-auto text-capitalize">${translateSourceText(type)}</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="${translateSourceText("Close")}"></button>
        </div>
        <div class="toast-body py-1 pb-3 px-3"></div>
      </div>
    `;

    const container = document.getElementById("toastContainer");
    if (container) {
      container.insertAdjacentHTML("beforeend", toastHtml);
      const toastEl = document.getElementById(toastId);
      toastEl.querySelector(".toast-body").textContent = translateSourceText(String(message));
      const bsToast = window.bootstrap?.Toast
        ? new window.bootstrap.Toast(toastEl, { delay: 4000 })
        : null;
      if (!bsToast) {
        toastEl.classList.add("show");
        setTimeout(() => toastEl.remove(), 4000);
        return;
      }
      bsToast.show();

      toastEl.addEventListener("hidden.bs.toast", () => {
        toastEl.remove();
      });
    }
  },
};

export function makeClientError(code, message) {
  const error = new Error(message || "An error occurred.");
  error.code = code || "INTERNAL_ERROR";
  return error;
}

export function handleSecurityErrorCode(code) {
  if (code === "EMAIL_VERIFICATION_REQUIRED" && store.get("session.loggedIn")) {
    refreshAccountSecurityState().catch(() => {});
  }
  if (
    ["MESSAGE_MUTED", "INTERACTION_RESTRICTED", "ACCOUNT_SUSPENDED", "BLOCKED_INTERACTION"]
      .includes(code)
  ) {
    ToastService.show(localizeError(code), "warning");
  }
}

export async function submitSafetyReport(targetType, targetId) {
  const reasonCode = window.prompt(
    "Reason: spam, harassment, threats, impersonation, sexual_content, illegal_content, privacy, or other",
    "other",
  );
  if (!reasonCode) return;
  const details = window.prompt("Optional details (maximum 2,000 characters):", "") || undefined;
  try {
    await apiFetch("/api/safety/reports", {
      method: "POST",
      body: JSON.stringify({ targetType, targetId, reasonCode, details }),
    });
    ToastService.show("Report submitted for review.", "success");
  } catch (error) {
    console.error("Report submission failed:", error);
  }
}

// HTTP Client (Bearer header + one-shot refresh retry on 401)
export async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};

  if (options.body && !(options.body instanceof FormData) && !options.headers["Content-Type"]) {
    options.headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await authenticatedFetch(url, options);
  } catch (err) {
    ToastService.show(localizeError("NETWORK_ERROR"), "error");
    throw err;
  }

  if (response.status === 401) {
    const message = localizeError("UNAUTHORIZED");
    clearAuthenticatedState(message, "warning");
    throw makeClientError("UNAUTHORIZED", message);
  }

  let responseJson;
  try {
    responseJson = await response.json();
  } catch {
    const errMsg = `Request failed (${response.status}).`;
    ToastService.show(errMsg, "error");
    throw new Error(errMsg);
  }
  if (!responseJson.success) {
    const errMsg = localizeError(
      responseJson.error?.code,
      responseJson.error?.message || t("error.INTERNAL_ERROR"),
    );
    handleSecurityErrorCode(responseJson.error?.code);
    ToastService.show(errMsg, "error");
    throw makeClientError(responseJson.error?.code, errMsg);
  }

  return responseJson.data;
}

export async function refreshAccountSecurityState() {
  const data = await apiFetch("/api/auth/account");
  store.set("accountSecurity", {
    email: data.email || "",
    emailVerifiedAt: data.emailVerifiedAt || null,
    pendingEmail: data.pendingEmail || null,
    isVerified: !!data.emailVerifiedAt,
  });
}
