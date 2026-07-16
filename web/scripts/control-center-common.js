import { formatDateTime, t, translateSourceText } from "./i18n.js";

export function formatDate(isoString) {
  if (!isoString) return t("common.notAvailable");
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return t("common.notAvailable");
    return formatDateTime(d);
  } catch {
    return t("common.notAvailable");
  }
}

export function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function el(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "textContent") {
      element.textContent = value;
    } else if (key === "className") {
      element.className = value;
    } else if (
      key.startsWith("data-") || key === "aria-selected" ||
      key === "aria-live" || key === "aria-atomic"
    ) {
      element.setAttribute(key, String(value));
    } else {
      element[key] = value;
    }
  }
  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof HTMLElement) {
      element.appendChild(child);
    }
  }
  return element;
}

export function renderToast(type, message) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const typeClasses = {
    success: "bg-success text-white",
    danger: "bg-danger text-white",
    warning: "bg-warning text-dark",
    info: "bg-info text-white",
  };

  const toastEl = el("div", {
    className: `toast align-items-center border-0 ${
      typeClasses[type] || "bg-dark text-white"
    }`,
    role: "alert",
    "aria-live": "assertive",
    "aria-atomic": "true",
  }, [
    el("div", { className: "d-flex" }, [
      el("div", { className: "toast-body", textContent: translateSourceText(message) }),
      el("button", {
        type: "button",
        className: "btn-close btn-close-white me-2 m-auto",
        "data-bs-dismiss": "toast",
        "aria-label": translateSourceText("Close"),
      }),
    ]),
  ]);

  container.appendChild(toastEl);
  const bs = (globalThis.window || globalThis).bootstrap;
  if (bs && bs.Toast) {
    const bsToast = new bs.Toast(toastEl, { delay: 4000 });
    bsToast.show();
  }

  toastEl.addEventListener("hidden.bs.toast", () => {
    toastEl.remove();
  });
}
