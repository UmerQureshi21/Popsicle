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
  const sent = api.called("POST /api/people-search/company")[0].body as { query: string; job_titles: string };
  expect(sent.query).toBe("stripe.com");
  // The default searches every software and data title, not just "software engineer".
  for (const title of ["software engineer", "software developer", "data scientist", "machine learning engineer"]) expect(sent.job_titles).toContain(title);
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

test("get a fresh batch of people you haven't emailed yet", async ({ page }) => {
  const api = await new FakeApi({
    "GET /api/people-search/suggest": [],
    "POST /api/people-search/company": {
      domain: "stripe.com", organization: "Stripe", pattern: "{first}", total: 30, offset: 0, limit: 10, cached: true,
      people: [person({ email: "sam@stripe.com", full_name: "Sam Lee", first_name: "Sam", already_emailed_at: "2026-03-01T12:00:00Z" })],
    },
    "POST /api/people-search/company/new": {
      domain: "stripe.com", organization: "Stripe", pattern: "{first}", total: 30, reached_end: false, pages_checked: 2, pages_paid: 1,
      people: [person({ email: "alex@stripe.com", full_name: "Alex Kim", first_name: "Alex" }), person({ email: "priya@stripe.com", full_name: "Priya Nair", first_name: "Priya" })],
    },
  }).install(page);

  await page.goto("/find");
  await page.getByRole("combobox", { name: "Add a company" }).fill("stripe.com");
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: /Hide people I’ve already seen/ }).check();
  await page.getByRole("button", { name: /^Search/ }).click();
  await expect(page.getByText("Sam Lee")).toBeVisible();

  await page.getByRole("button", { name: /Get 10 new people/ }).click();
  await expect(page.getByText("Alex Kim")).toBeVisible();
  await expect(page.getByText("Sam Lee")).toHaveCount(0);
  await expect(page.getByText("2 people you haven’t seen or emailed. Used about 1 credit.")).toBeVisible();
  expect(api.called("POST /api/people-search/company/new")[0].body).toMatchObject({ query: "stripe.com", want: 10, hide_seen: true });

  await page.getByRole("button", { name: /Email 2 people/ }).click();
  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByRole("textbox", { name: "Row 1 email" })).toHaveValue("alex@stripe.com");
  await expect(page.getByRole("textbox", { name: "Row 2 email" })).toHaveValue("priya@stripe.com");
});

test("people emailed since a search show as emailed and unticked when you come back to Find people", async ({ page }) => {
  const sam = person({ email: "sam@stripe.com", full_name: "Sam Lee", first_name: "Sam" });
  let emailed: Record<string, { already_emailed_at: string | null; in_batch: boolean }> = {};
  await new FakeApi({
    "GET /api/people-search/suggest": [],
    "POST /api/people-search/company": {
      domain: "stripe.com", organization: "Stripe", pattern: "{first}", total: 2, offset: 0, limit: 10, cached: false,
      people: [person(), sam],
    },
    "POST /api/people-search/emailed": (body) => ({
      people: (body as { emails: string[] }).emails.map((email) => ({
        email, ...(emailed[email] ?? { already_emailed_at: null, in_batch: false }),
      })),
    }),
  }).install(page);

  await page.goto("/find");
  await page.getByRole("combobox", { name: "Add a company" }).fill("stripe.com");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Search/ }).click();
  await expect(page.getByRole("button", { name: /Email 2 people/ })).toBeVisible();

  // Jane gets emailed, and Sam is waiting in a batch that's still sending.
  emailed = {
    "jane@stripe.com": { already_emailed_at: "2026-11-25T14:00:00Z", in_batch: false },
    "sam@stripe.com": { already_emailed_at: null, in_batch: true },
  };
  await page.reload();

  const jane = page.locator("label", { hasText: "Jane Doe" });
  const samRow = page.locator("label", { hasText: "Sam Lee" });
  await expect(jane).toHaveAttribute("data-already-emailed", "true");
  await expect(jane.getByText(/Already emailed · Nov 25/)).toBeVisible();
  await expect(jane.getByRole("checkbox")).not.toBeChecked();
  await expect(samRow.getByText("In a batch")).toBeVisible();
  await expect(samRow.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", { name: /Email 0 people/ })).toBeDisabled();
});

test("get 100 new people at a company and take them all to Compose", async ({ page }) => {
  const api = await new FakeApi({
    "GET /api/people-search/suggest": [],
    "POST /api/people-search/company": {
      domain: "stripe.com", organization: "Stripe", pattern: "{first}", total: 300, offset: 0, limit: 100, cached: true, people: [person()],
    },
    // Like the backend: up to 25 a time, carrying on after the people the page already has.
    "POST /api/people-search/company/new": (body) => {
      const { want, skip } = body as { want: number; skip: string[] };
      return {
        domain: "stripe.com", organization: "Stripe", pattern: "{first}", total: 300, reached_end: false,
        pages_checked: 3, pages_paid: 1, next_offset: skip.length + 20,
        people: Array.from({ length: want }, (_, i) => {
          const n = skip.length + i;
          return person({ email: `p${n}@stripe.com`, full_name: `Person ${n}`, first_name: `P${n}` });
        }),
      };
    },
  }).install(page);

  await page.goto("/find");
  await page.getByRole("combobox", { name: "Add a company" }).fill("stripe.com");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "People per company" }).click();
  await page.getByRole("option", { name: /Up to 100/ }).click();
  await page.getByRole("button", { name: /^Search/ }).click();
  await expect(page.getByText("Jane Doe")).toBeVisible();
  expect(api.called("POST /api/people-search/company")[0].body).toMatchObject({ limit: 100 });

  await page.getByRole("button", { name: /Get 100 new people/ }).click();
  await expect(page.getByText("100 people you haven’t emailed. Used about 4 credits.")).toBeVisible();
  expect(api.called("POST /api/people-search/company/new")).toHaveLength(4);

  await page.getByRole("button", { name: /Email 100 people/ }).click();
  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByText("Loaded 100 people from Stripe.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Row 100 email" })).toHaveValue("p99@stripe.com");
});
