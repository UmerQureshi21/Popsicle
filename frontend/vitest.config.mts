import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        // Display-only landing page and the root layout (fonts, metadata).
        "src/components/landing/**",
        "src/app/page.tsx",
        "src/app/layout.tsx",
      ],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
