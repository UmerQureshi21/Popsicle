/** Theme constants safe to use on the server (the root layout), with no React in them. */

export type Theme = "light" | "dark";

export const THEME_KEY = "popsicle:theme";

/** Pages with a set theme, whatever the toggle says: the landing page is dark (its light trails
 * read best on a dark background). */
export const FIXED_THEME: Record<string, Theme> = { "/": "dark" };

/**
 * Runs in <head> before the page is first drawn, so the saved theme shows straight away
 * instead of flashing light first. A fixed string (no data in it).
 */
export const NO_FLASH_SCRIPT = `try{var f=${JSON.stringify(FIXED_THEME)}[location.pathname];document.documentElement.dataset.theme=f||(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark"?"dark":"light")}catch(e){}`;
