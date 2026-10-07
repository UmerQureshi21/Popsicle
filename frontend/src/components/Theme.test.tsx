import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_KEY } from "@/lib/theme";
import { navigation } from "@/test/navigation";
import { ThemeSync, ThemeToggle } from "./Theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("ThemeToggle", () => {
  it("switches between light and dark in one click, and remembers it", async () => {
    navigation.pathname = "/compose";
    render(
      <>
        <ThemeSync />
        <ThemeToggle />
      </>,
    );
    const user = userEvent.setup();
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("follows a switch made in another tab", async () => {
    navigation.pathname = "/compose";
    render(<ThemeSync />);
    localStorage.setItem(THEME_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });
});

describe("ThemeSync", () => {
  it("keeps the landing page light even when dark is chosen", () => {
    localStorage.setItem(THEME_KEY, "dark");
    navigation.pathname = "/";
    render(<ThemeSync />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
