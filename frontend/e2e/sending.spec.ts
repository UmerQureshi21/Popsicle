import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";

const emailRow = (status: string) => ({
  id: 1, contact_id: 1, to_email: "jane@stripe.com", subject: "Quick question about Stripe", body: "Hi Jane",
  variables: {}, status, error: null, sent_at: status === "sent" ? "2026-10-05T12:00:00Z" : null, created_at: "2026-10-05T12:00:00Z",
});

const campaign = (status: string, emailStatus: string) => ({
  id: 7, name: "Stripe", company_id: 1, company_name: "Stripe", status, error: null, delay_seconds: 30,
  created_at: "2026-10-05T12:00:00Z", started_at: "2026-10-05T12:00:00Z", finished_at: status === "completed" ? "2026-10-05T12:00:05Z" : null,
  counts: { total: 1, pending: emailStatus === "pending" ? 1 : 0, sent: emailStatus === "sent" ? 1 : 0, failed: 0, skipped: 0, cancelled: 0 },
  subject_template: "Quick question about {{company}}", body_template: "Hi {{first_name}}", variables: ["full_name", "email"],
  attachments: [], emails: [emailRow(emailStatus)],
});

test("write an email, review it and send it", async ({ page }) => {
  let polls = 0;
  const api = await new FakeApi({
    "POST /api/campaigns/preview": (body) => {
      const draft = body as { rows: Record<string, string>[] };
      return {
        items: draft.rows.map((values, index) => ({
          index, to_email: values.email, subject: "Quick question about Stripe", body: "Hi Jane,\n\nI came across your profile…",
          values, status: "ready", issues: [], last_sent_at: null,
        })),
        ready: draft.rows.length, already_sent: 0, invalid: 0,
      };
    },
    "POST /api/campaigns": campaign("sending", "pending"),
    // The progress view polls until the batch is done.
    "GET /api/campaigns/7": () => (++polls > 1 ? campaign("completed", "sent") : campaign("sending", "pending")),
  }).install(page);

  await page.goto("/compose");
  await expect(page.getByRole("link", { name: "me@gmail.com" })).toBeVisible();
  await expect(page.getByText("Add at least one recipient")).toBeVisible();

  await page.getByPlaceholder("e.g. Stripe").fill("Stripe");
  await page.getByRole("textbox", { name: "Row 1 full_name" }).fill("Jane Doe");
  await page.getByRole("textbox", { name: "Row 1 email" }).fill("jane@stripe.com");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const review = page.getByRole("dialog");
  await expect(review.getByRole("heading", { name: "Quick question about Stripe" })).toBeVisible();
  expect(api.called("POST /api/campaigns/preview")[0].body).toMatchObject({
    company: "Stripe",
    rows: [{ full_name: "Jane Doe", email: "jane@stripe.com" }],
    skip_already_sent: true,
  });
  await review.getByRole("button", { name: /Send 1 email/ }).click();

  await expect(page.getByText("next: jane@stripe.com")).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("1 of 1 sent")).toBeVisible();
  expect(api.called("POST /api/campaigns")).toHaveLength(1);

  await page.getByRole("button", { name: "Start next company" }).click();
  await expect(page.getByPlaceholder("e.g. Stripe")).toHaveValue("");

  // The draft survives a reload.
  await page.getByRole("textbox", { name: "Subject" }).fill("Saved subject");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Subject" })).toHaveValue("Saved subject");
});

test("verify addresses and see the daily limit before sending", async ({ page }) => {
  const people = [
    { full_name: "Jane Doe", email: "jane@stripe.com" },
    { full_name: "Gone Person", email: "gone@stripe.com" },
    { full_name: "Sam Lee", email: "sam@stripe.com" },
  ];
  let verified = false;
  const verdict = (email: string, status: string) => ({ email, status, score: 90, checked_at: "2026-10-05T12:00:00Z", cached: !verified });
  const quota = { daily_limit: 40, min_delay_seconds: 20, sent_last_24h: 39, remaining: 1, next_slot_at: "2026-10-06T12:00:00Z", oldest_sent_at: "2026-10-05T15:00:00Z" };
  const api = await new FakeApi({
    "GET /api/people-search/status": {
      configured: true, plan_name: "Free", credits_used: 10, credits_total: 50, credits_remaining: 40,
      verifications_total: 100, verifications_remaining: 94, reset_date: "2026-11-02", error: null,
    },
    "POST /api/campaigns/preview": () => {
      const items = people.map((values, index) => {
        const gone = values.email.startsWith("gone");
        return {
          index, to_email: values.email, subject: "Quick question about Stripe", body: `Hi ${values.full_name.split(" ")[0]}`,
          values, issues: [], last_sent_at: null,
          status: verified && gone ? "undeliverable" : "ready",
          verification: verified ? verdict(values.email, gone ? "invalid" : "valid") : null,
        };
      });
      const ready = items.filter((i) => i.status === "ready").length;
      return {
        items, ready, already_sent: 0, invalid: 0, undeliverable: verified ? 1 : 0, quota,
        sends_now: Math.min(ready, quota.remaining), sends_later: Math.max(0, ready - quota.remaining), later_from: "2026-10-06T15:00:00Z",
      };
    },
    "POST /api/people-search/verify": () => {
      verified = true;
      return { results: people.map((p) => verdict(p.email, p.email.startsWith("gone") ? "invalid" : "valid")) };
    },
    "POST /api/campaigns": campaign("waiting", "pending"),
    "GET /api/campaigns/7": campaign("waiting", "pending"),
  }).install(page);

  await page.goto("/compose");
  await page.getByPlaceholder("e.g. Stripe").fill("Stripe");
  for (const [i, p] of people.entries()) {
    await page.getByRole("textbox", { name: `Row ${i + 1} full_name` }).fill(p.full_name);
    await page.getByRole("textbox", { name: `Row ${i + 1} email` }).fill(p.email);
    if (i < people.length - 1) await page.getByRole("button", { name: "Add recipient" }).click();
  }
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const review = page.getByRole("dialog");
  await expect(review.getByText(/Check 3 addresses exist before sending/)).toContainText("Uses 3 of your 94 Hunter verifications left this month.");
  await expect(review.getByText(/Your daily limit is 40 emails \(1 left right now\)\./)).toBeVisible();
  await review.getByRole("button", { name: "Verify 3" }).click();

  await expect(review.getByText(/Addresses checked:/)).toContainText("2 verified · 1 doesn’t exist");
  await expect(review.getByText("1 doesn't exist (skipped)")).toBeVisible();
  await expect(review.getByText(/1 will send now; the other 1 will wait and go out automatically/)).toBeVisible();
  expect(api.called("POST /api/people-search/verify")[0].body).toEqual({ emails: people.map((p) => p.email) });

  await review.getByRole("button", { name: /Send 2 emails/ }).click();
  await expect(page.getByText("waiting for daily limit")).toBeVisible();
  expect(api.called("POST /api/campaigns")).toHaveLength(1);
});

test("see and change the daily limit on the Sent page", async ({ page }) => {
  const quota = { daily_limit: 40, min_delay_seconds: 20, sent_last_24h: 6, remaining: 34, next_slot_at: "2026-10-06T12:00:00Z", oldest_sent_at: null };
  const api = await new FakeApi({
    "GET /api/stats": { sent_total: 6, sent_last_7_days: 6, companies: 1, contacts: 6, failed_total: 0 },
    "GET /api/campaigns": [],
    "GET /api/sending/quota": quota,
    "PUT /api/sending/settings": (body) => ({ ...quota, ...(body as object), remaining: 24 }),
  }).install(page);

  await page.goto("/sent");
  await expect(page.getByText("6 of 40 sent in the last 24 hours")).toBeVisible();
  await page.getByRole("button", { name: "Edit limits" }).click();
  await page.getByRole("spinbutton", { name: "Emails per 24 hours" }).fill("30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("6 of 30 sent in the last 24 hours")).toBeVisible();
  expect(api.called("PUT /api/sending/settings")[0].body).toEqual({ daily_limit: 30, min_delay_seconds: 20 });
});

test("schedule a batch for later, then send it now", async ({ page }) => {
  const scheduledFor = "2026-10-07T13:00:00Z";
  const api = await new FakeApi({
    "POST /api/campaigns/preview": (body) => {
      const draft = body as { rows: Record<string, string>[] };
      return {
        items: draft.rows.map((values, index) => ({
          index, to_email: values.email, subject: "Quick question about Stripe", body: "Hi Jane",
          values, status: "ready", issues: [], last_sent_at: null,
        })),
        ready: draft.rows.length, already_sent: 0, invalid: 0,
      };
    },
    "POST /api/campaigns": { ...campaign("scheduled", "pending"), scheduled_for: scheduledFor },
    "GET /api/campaigns/7": { ...campaign("scheduled", "pending"), scheduled_for: scheduledFor },
    "POST /api/campaigns/7/send-now": campaign("completed", "sent"),
  }).install(page);

  await page.goto("/compose");
  await page.getByPlaceholder("e.g. Stripe").fill("Stripe");
  await page.getByRole("textbox", { name: "Row 1 full_name" }).fill("Jane Doe");
  await page.getByRole("textbox", { name: "Row 1 email" }).fill("jane@stripe.com");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const review = page.getByRole("dialog");
  await review.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(review.getByText(/Times are in your timezone/)).toBeVisible();
  await review.getByRole("button", { name: /^Tomorrow, .* 9:00/ }).click();

  await expect(page.getByText(/Scheduled for Oct 7/)).toBeVisible();
  const sentBody = api.called("POST /api/campaigns")[0].body as { scheduled_for: string };
  const at = new Date(sentBody.scheduled_for);
  expect(at.getTime()).toBeGreaterThan(Date.now());
  expect(at.getHours()).toBe(9);

  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText("completed")).toBeVisible();
  expect(api.called("POST /api/campaigns/7/send-now")).toHaveLength(1);
});
