import { useCallback, useSyncExternalStore } from "react";
import { LIGHT_ONLY, THEME_KEY, type Theme } from "./themeScript";

export { LIGHT_ONLY, NO_FLASH_SCRIPT, THEME_KEY, type Theme } from "./themeScript";

const THEME_EVENT = "popsicle:theme";

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function themeFor(pathname: string, chosen: Theme): Theme {
  return LIGHT_ONLY.has(pathname) ? "light" : chosen;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab switched
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The chosen theme and a way to change it; light until the page is running in a browser. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, storedTheme, () => "light" as Theme);
  const set = useCallback((t: Theme) => saveTheme(t), []);
  return [theme, set];
}
