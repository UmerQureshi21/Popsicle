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
