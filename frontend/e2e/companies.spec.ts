import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";

const company = (id: number, name: string, domain: string | null, status = "not_started") => ({
  id, name, domain, status, linkedin_url: null, notes: null, created_at: "2026-10-01T12:00:00Z",
  contact_count: 0, emailed_count: 0, last_sent_at: null,
});

test("build a target list, track statuses, and find people at the ones left", async ({ page }) => {
  let list = [company(1, "Stripe", "stripe.com", "emailed")];
  const api = await new FakeApi({
    "GET /api/companies": () => list,
    "GET /api/people-search/suggest": [],
    "POST /api/companies/bulk": (body) => {
      const added = [company(2, "Shopify", "shopify.com"), company(3, "Wealthsimple", null)];
      list = [...list, ...added];
      expect(body).toEqual({ lines: ["Shopify", "Wealthsimple"] });
      return { added, skipped: [] };
    },
    "POST /api/companies/fill-domains": () => {
      list = list.map((c) => (c.id === 3 ? { ...c, domain: "wealthsimple.com" } : c));
      return { filled: 1, missing: 0 };
    },
    "PATCH /api/companies/1": (body) => ({ ...list[0], ...(body as object) }),
  }).install(page);

  await page.goto("/companies");
  await expect(page.getByText("Stripe", { exact: true })).toBeVisible();

  // Paste a list of companies.
  await page.getByRole("button", { name: "Add companies" }).click();
  const input = page.getByRole("combobox", { name: "Company name or domain" });
  await input.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "Shopify\nWealthsimple");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByRole("button", { name: "Add 2" }).click();
  await expect(page.getByText("Added 2 companies.")).toBeVisible();

  // One has no domain yet; Hunter fills it so its logo shows.
  await page.getByRole("button", { name: "Find 1 missing logo" }).click();
  await expect(page.getByText("wealthsimple.com", { exact: true })).toBeVisible();

  // Mark Stripe as replied.
  await page.getByRole("button", { name: "Status of Stripe" }).click();
  await page.getByRole("option", { name: "Replied" }).click();
  await expect(page.getByRole("tab", { name: /Replied/ })).toHaveText("Replied 1");
  expect(api.called("PATCH /api/companies/1")[0].body).toEqual({ status: "replied" });

  // The ones not started yet go to Find people.
  await page.getByRole("tab", { name: /Not started/ }).click();
  await expect(page.getByText("Stripe", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Shopify" }).check();
  await page.getByRole("checkbox", { name: "Select Wealthsimple" }).check();
  await page.getByRole("button", { name: "Find people at 2 companies" }).click();

  await expect(page).toHaveURL(/\/find$/);
  await expect(page.getByRole("button", { name: "Remove Shopify" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Wealthsimple" })).toBeVisible();
});
