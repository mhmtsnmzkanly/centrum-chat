import { controlCenterStore } from "../state/store.js";
import { handleAuthLoss } from "../api/controlCenterApi.js";

export function initShell() {
  const themeToggle = document.getElementById("btn-theme-toggle");
  const logoutBtn = document.getElementById("btn-control-logout");

  const accessDeniedView = document.getElementById("access-denied-view");
  const workspaceShell = document.getElementById("control-center-shell");

  const opName = document.getElementById("operator-name");
  const opAvatar = document.getElementById("operator-avatar");
  const opRole = document.getElementById("operator-role");

  // 1. Theme restoration and toggle
  const isDarkMode = localStorage.getItem("chat_dark_mode") === "1";
  if (isDarkMode) {
    document.body.classList.add("dark-mode");
    themeToggle?.querySelector("i")?.setAttribute("class", "bi bi-sun");
  } else {
    document.body.classList.remove("dark-mode");
    themeToggle?.querySelector("i")?.setAttribute("class", "bi bi-moon-stars");
  }

  themeToggle?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("chat_dark_mode", isDark ? "1" : "0");
    themeToggle.querySelector("i")?.setAttribute(
      "class",
      isDark ? "bi bi-sun" : "bi bi-moon-stars",
    );
  });

  // 2. Auth handlers
  logoutBtn?.addEventListener("click", () => {
    handleAuthLoss();
  });

  // 3. Subscribe to access/operator states
  controlCenterStore.subscribe((state) => {
    const { accessDenied, operator } = state;

    if (accessDenied) {
      accessDeniedView?.classList.remove("d-none");
      workspaceShell?.classList.add("d-none");
      return;
    }

    accessDeniedView?.classList.add("d-none");
    workspaceShell?.classList.remove("d-none");

    if (operator) {
      if (opName) {
        opName.textContent = operator.displayName || operator.username;
      }
      if (opAvatar) {
        opAvatar.textContent =
          (operator.displayName || operator.username || "OP")
            .substring(0, 2)
            .toUpperCase();
      }
      if (opRole) {
        opRole.textContent = operator.role.toUpperCase();

        // Dynamic colors based on role
        if (operator.role === "owner") {
          opRole.className =
            "badge bg-danger-subtle text-danger border border-danger-subtle";
        } else if (operator.role === "admin") {
          opRole.className =
            "badge bg-warning-subtle text-warning border border-warning-subtle";
        } else {
          opRole.className =
            "badge bg-primary-subtle text-primary border border-primary-subtle";
        }
      }
    }
  });
}
