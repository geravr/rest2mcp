export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "app-theme";
const THEME_EVENT = "app-theme-change";

export function getStoredTheme(): Theme | null {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);

  return value === "dark" || value === "light" ? value : null;
}

export function getTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;

  if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function notifyThemeChange() {
  window.dispatchEvent(
    new CustomEvent<Theme>(THEME_EVENT, { detail: getTheme() }),
  );
}

export function setTheme(theme: Theme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
  notifyThemeChange();
}

export function initializeTheme() {
  const theme = getTheme();
  applyTheme(theme);
}

export function subscribeToTheme(callback: () => void) {
  const handleThemeChange = () => callback();

  window.addEventListener(THEME_EVENT, handleThemeChange);

  return () => window.removeEventListener(THEME_EVENT, handleThemeChange);
}
