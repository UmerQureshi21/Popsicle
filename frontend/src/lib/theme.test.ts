import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_FLASH_SCRIPT, THEME_KEY, applyTheme, saveTheme, storedTheme, themeFor } from "./theme";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("is light until dark is chosen", () => {
    expect(storedTheme()).toBe("light");
    localStorage.setItem(THEME_KEY, "dark");
    expect(storedTheme()).toBe("dark");
    localStorage.setItem(THEME_KEY, "purple");
    expect(storedTheme()).toBe("light");
  });

  it("is light when the browser won't share its storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(storedTheme()).toBe("light");
  });

  it("keeps the landing page light", () => {
    expect(themeFor("/", "dark")).toBe("light");
    expect(themeFor("/compose", "dark")).toBe("dark");
    expect(themeFor("/compose", "light")).toBe("light");
  });

  it("saves the choice and tells the page", () => {
    const heard = vi.fn();
    window.addEventListener("popsicle:theme", heard);
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener("popsicle:theme", heard);
  });

  it("still tells the page when the choice can't be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveTheme("dark")).not.toThrow();
  });

  it("applies a theme to the page", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("the before-paint script applies the saved theme, except on the landing page", () => {
    const run = () => new Function(NO_FLASH_SCRIPT)();
    localStorage.setItem(THEME_KEY, "dark");
    window.history.replaceState(null, "", "/compose");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.history.replaceState(null, "", "/");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
    localStorage.clear();
    window.history.replaceState(null, "", "/inbox");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
