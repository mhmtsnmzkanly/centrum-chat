export const THEME_KEY = "chat_dark_mode";

export function getSystemTheme() {
  return localStorage.getItem(THEME_KEY) === "1" ? "dark" : "light";
}

export function applySystemTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    localStorage.setItem(THEME_KEY, "1");
  } else {
    document.body.classList.remove("dark-mode");
    localStorage.setItem(THEME_KEY, "0");
  }
}
