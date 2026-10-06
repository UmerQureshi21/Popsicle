import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * End-to-end tests drive the real app in a browser. The backend is faked inside the browser
 * (e2e/fake-api.ts), so no Hunter credits are spent and no email is sent. The app is built into
 * .next-e2e and pointed at a made-up API address, so a running `next dev` or real backend is
 * never touched.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_API_URL: "http://api.e2e.test" },
  },
});
