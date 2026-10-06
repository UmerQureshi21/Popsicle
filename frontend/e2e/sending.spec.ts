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
