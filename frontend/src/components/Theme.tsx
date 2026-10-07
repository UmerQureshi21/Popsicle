"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { applyTheme, themeFor, useTheme } from "@/lib/theme";

/** Keeps the page's colours in step with the chosen theme as you move between pages. */
export function ThemeSync() {
  const pathname = usePathname();
  const [theme] = useTheme();
  useEffect(() => applyTheme(themeFor(pathname, theme)), [pathname, theme]);
  return null;
}

/** One click between the light and dark palettes. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid size-9 place-items-center rounded-xl text-ink/70 transition-colors hover:bg-cloud hover:text-ink ${className}`}
    >
      {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
