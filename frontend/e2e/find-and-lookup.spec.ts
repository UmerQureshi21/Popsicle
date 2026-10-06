import { expect, test } from "@playwright/test";
import { FakeApi, person } from "./fake-api";

test("find people at a company and take them to Compose", async ({ page }) => {
  const api = await new FakeApi({
    "GET /api/people-search/suggest": [],
    "POST /api/people-search/company": {
      domain: "stripe.com",
      organization: "Stripe",
      pattern: "{first}",
      total: 2,
      offset: 0,
      limit: 10,
      cached: false,
      people: [person(), person({ email: "sam@stripe.com", full_name: "Sam Lee", first_name: "Sam", already_emailed_at: "2026-03-01T12:00:00Z" })],
    },
  }).install(page);

  await page.goto("/find");
  await page.getByRole("combobox", { name: "Add a company" }).fill("stripe.com");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Search/ }).click();

  await expect(page.getByText("Jane Doe")).toBeVisible();
  // Sam was emailed before: his row carries the red early warning.
  await expect(page.locator("label[data-already-emailed]")).toHaveCount(1);
  await expect(page.locator("label[data-already-emailed]")).toContainText("Sam Lee");
  await expect(page.getByText(/Already emailed · Mar 1/)).toBeVisible();
  await expect(page.getByText("· 1 already emailed")).toBeVisible();
  expect(api.called("POST /api/people-search/company")[0].body).toMatchObject({ query: "stripe.com", job_titles: "software engineer" });
  // Sam was already emailed, so only Jane is picked.
  await page.getByRole("button", { name: /Email 1 person/ }).click();

  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByText("Loaded 1 person from Stripe.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Row 1 email" })).toHaveValue("jane@stripe.com");
  await expect(page.getByRole("textbox", { name: "Row 1 role" })).toHaveValue("Software Engineer");
  await expect(page.getByPlaceholder("e.g. Stripe")).toHaveValue("Stripe");
});

test("look up one person from their LinkedIn profile and add them to the batch", async ({ page }) => {
  const api = await new FakeApi({
    "POST /api/people-search/person": {
      person: person({ email: "jane@harvey.ai", linkedin_url: "https://linkedin.com/in/jane-doe" }),
      domain: "harvey.ai",
      company: "Harvey",
      cached: false,
    },
  }).install(page);

  // Someone is already in the batch.
  await page.goto("/compose");
  await page.getByRole("textbox", { name: "Row 1 email" }).fill("sam@x.com");

  await page.getByRole("link", { name: "Look up" }).first().click();
  await page.getByPlaceholder("linkedin.com/in/jane-doe").fill("https://www.linkedin.com/in/jane-doe/");
  await page.getByRole("button", { name: "Find email" }).click();

  await expect(page.getByText("jane@harvey.ai")).toBeVisible();
  await expect(page.getByText("Verified")).toBeVisible();
  expect(api.called("POST /api/people-search/person")[0].body).toEqual({
    company: null,
    full_name: null,
    linkedin_url: "https://www.linkedin.com/in/jane-doe/",
  });

  await page.getByRole("button", { name: "Add to batch" }).click();
  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByText("Added 1 person to this batch.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Row 1 email" })).toHaveValue("sam@x.com");
  await expect(page.getByRole("textbox", { name: "Row 2 email" })).toHaveValue("jane@harvey.ai");

  // The lookup is remembered on the Look up page.
  await page.goto("/lookup");
  await expect(page.getByText("Recent lookups")).toBeVisible();
});
