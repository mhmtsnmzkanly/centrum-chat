import { t } from "./i18n.js";

export const CONTROL_CENTER_BOOT_STAGES = Object.freeze([
  "SESSION",
  "LOCALE",
  "PERMISSIONS",
  "RENDER",
  "INITIAL_DATA",
  "READY",
]);

export const CONTROL_CENTER_STARTUP_ERRORS = Object.freeze({
  SESSION: "SESSION_RESOLUTION_FAILED",
  PERMISSIONS: "PERMISSION_RESOLUTION_FAILED",
  LOCALE: "LOCALE_INITIALIZATION_FAILED",
  LIME: "LIME_RENDER_FAILED",
  INITIAL_DATA: "INITIAL_DATA_FAILED",
  UNKNOWN: "UNKNOWN_INITIALIZATION_ERROR",
});

export class ControlCenterStartupError extends Error {
  constructor(code, cause, detailCode = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "ControlCenterStartupError";
    this.code = code;
    this.detailCode = detailCode;
  }
}

export function startupError(code, cause, detailCode = null) {
  return new ControlCenterStartupError(code, cause, detailCode);
}

export function classifyControlCenterStartupError(error) {
  if (error instanceof ControlCenterStartupError) return error;
  return startupError(CONTROL_CENTER_STARTUP_ERRORS.UNKNOWN, error);
}

export function setBootStage(stage) {
  if (!CONTROL_CENTER_BOOT_STAGES.includes(stage)) return;
  const stageElement = document.getElementById("cc-boot-stage");
  if (stageElement) {
    stageElement.hidden = false;
    stageElement.textContent = t("control.boot.stageLabel", {
      stage: t(`control.boot.stage.${stage}`),
    });
  }
}

export function showBootError(error) {
  const title = document.getElementById("cc-boot-title");
  const stage = document.getElementById("cc-boot-stage");
  const progress = document.getElementById("cc-boot-progress");
  const errorRegion = document.getElementById("cc-boot-error");
  const errorType = document.getElementById("cc-boot-error-type");
  const errorDetail = document.getElementById("cc-boot-error-detail");
  const errorMessage = document.getElementById("cc-boot-error-message");
  const actions = document.getElementById("cc-boot-actions");

  if (title) title.textContent = t("control.boot.failedTitle");
  if (stage) stage.hidden = true;
  if (progress) progress.hidden = true;
  if (errorType) {
    errorType.textContent = t("control.boot.errorType", { code: error.code });
  }
  if (errorDetail) {
    errorDetail.hidden = !error.detailCode;
    errorDetail.textContent = error.detailCode
      ? t("control.boot.detailCode", { code: error.detailCode })
      : "";
  }
  if (errorMessage) {
    errorMessage.textContent = t(`control.boot.error.${error.code}`);
  }
  if (errorRegion) errorRegion.hidden = false;
  if (actions) actions.hidden = false;
}

export function finishBoot() {
  document.getElementById("app-loading-screen")?.remove();
}

export function bindBootActions() {
  document.getElementById("cc-boot-retry")?.addEventListener("click", () => {
    window.location.reload();
  }, { once: true });
}
