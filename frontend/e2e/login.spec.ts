import { expect, test } from "@playwright/test";
import { FakeApi, Reply } from "./fake-api";

test("when login is required, you log in and land on the page you asked for", async ({ page }) => {
  let user: { email: string; name: string | null } | null = null;
  const api = await new FakeApi({
    "GET /api/auth/me": () => ({ user, auth_required: true }),
    "POST /api/auth/login": (body) => {
      const { email, password } = body as { email: string; password: string };
      if (password !== "correct horse") return new Reply(401, { detail: "That email and password don't match an account." });
      user = { email, name: "Me" };
      return user;
    },
    "POST /api/auth/logout": () => {
      user = null;
      return new Reply(204);
    },
  }).install(page);

  await page.goto("/find");
  await expect(page).toHaveURL(/\/login\?next=%2Ffind$/);

  await page.getByPlaceholder("you@example.com").fill("me@example.com");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("That email and password don't match an account.");

  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/find$/);
  await expect(page.getByRole("heading", { name: "Find people" })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText("me@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  // The login guard may add ?next= for the page you were on; either way you're on the login page.
  await expect(page).toHaveURL(/\/login(\?next=%2Ffind)?$/);
  expect(api.called("POST /api/auth/logout")).toHaveLength(1);
});

test("signing up with an email that wasn't invited is refused", async ({ page }) => {
  await new FakeApi({
    "GET /api/auth/me": { user: null, auth_required: true },
    "POST /api/auth/signup": new Reply(403, { detail: "Popsicle is invite-only. Ask for access and you'll get an account." }),
  }).install(page);

  await page.goto("/login");
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByPlaceholder("you@example.com").fill("stranger@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long enough");
  await page.getByLabel("Confirm password").fill("long enough");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("invite-only");
});

test("pages carry the security headers", async ({ page }) => {
  await new FakeApi().install(page);
  const res = await page.goto("/compose");
  const headers = res!.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("the theme switch: one click to dark, remembered, and the landing page stays light", async ({ page }) => {
  await new FakeApi().install(page);
  await page.goto("/sent");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(23, 25, 37)");

  // Remembered, and applied before the page is drawn (no light flash).
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.goto("/compose");
  await expect(html).toHaveAttribute("data-theme", "dark");
});
