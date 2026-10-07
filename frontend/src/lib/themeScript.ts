/** Theme constants safe to use on the server (the root layout), with no React in them. */

export type Theme = "light" | "dark";

export const THEME_KEY = "popsicle:theme";

/** Pages that keep the light theme whatever the toggle says (the landing page, for now). */
export const LIGHT_ONLY = new Set(["/"]);

/**
 * Runs in <head> before the page is first drawn, so the saved theme shows straight away
 * instead of flashing light first. A fixed string (no data in it).
 */
export const NO_FLASH_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});document.documentElement.dataset.theme=t==="dark"&&!${JSON.stringify([...LIGHT_ONLY])}.includes(location.pathname)?"dark":"light"}catch(e){}`;
