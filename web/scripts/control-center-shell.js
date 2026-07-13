import { handleAuthLoss } from "./control-center-api.js";
import { getSystemTheme, applySystemTheme } from "./shared-theme.js";

export function initShell() {
  const isDarkMode = getSystemTheme() === "dark";
  const themeToggle = document.getElementById("btn-theme-toggle");
  if (isDarkMode) {
    document.body.classList.add("dark-mode");
    themeToggle?.querySelector("i")?.setAttribute("class", "bi bi-sun");
  } else {
    document.body.classList.remove("dark-mode");
    themeToggle?.querySelector("i")?.setAttribute("class", "bi bi-moon-stars");
  }
}

export const shellHandlers = {
  toggleCCTheme(e, el) {
    const isDark = document.body.classList.toggle("dark-mode");
    applySystemTheme(isDark ? "dark" : "light");
    el.querySelector("i")?.setAttribute(
      "class",
      isDark ? "bi bi-sun" : "bi bi-moon-stars",
    );
  },

  logoutCC() {
    handleAuthLoss();
  }
};
