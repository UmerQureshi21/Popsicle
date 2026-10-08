import { expect, test } from "@playwright/test";
import { FakeApi, conversationsPage } from "./fake-api";

// Everything here is answered by FakeApi in the browser: nothing reaches Gmail or Google Calendar.

const douglas = {
  contact_id: 3, email: "douglas.quan@ibm.com", full_name: "Douglas Quan", title: "Software Engineer", linkedin_url: null,
  company_name: "IBM", company_domain: null, first_emailed_at: "2026-10-04T19:08:00Z", last_message_at: "2026-10-05T14:00:00Z",
  last_snippet: "Coffee next week works!", last_from_me: false, replied: true, message_count: 2, next_meeting_at: null,
};

test("see a reply and set up a Google Meet", async ({ page }) => {
  const meetings: object[] = [];
  const api = await new FakeApi({
    "GET /api/gmail/status": { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true },
    "POST /api/conversations/sync": { threads_checked: 1, threads_downloaded: 1, new_messages: 1, synced_at: "2026-10-06T12:00:00Z" },
    "GET /api/conversations": conversationsPage([douglas]),
    "GET /api/conversations/3": () => ({
      ...douglas,
      meetings,
      messages: [
        { id: "m1", from_me: true, from_name: null, from_addr: "me@gmail.com", to: douglas.email, subject: "Coffee chat Request",
          body: "Hi Douglas, would you have 30 minutes for a call?", sent_at: "2026-10-04T19:08:00Z", gmail_thread_id: "t1" },
        { id: "m2", from_me: false, from_name: "Douglas Quan", from_addr: douglas.email, to: "me@gmail.com", subject: "Re: Coffee chat Request",
          body: "Happy to! Coffee next week works.", sent_at: "2026-10-05T14:00:00Z", gmail_thread_id: "t1" },
      ],
    }),
    "POST /api/conversations/3/meeting": (body) => {
      const b = body as { title: string; starts_at: string; duration_minutes: number };
      const m = {
        id: 1, title: b.title, starts_at: b.starts_at, ends_at: new Date(new Date(b.starts_at).getTime() + b.duration_minutes * 60_000).toISOString(),
        time_zone: "America/Toronto", meet_url: "https://meet.google.com/abc-defg-hij", calendar_url: null, calendar_invite: true, created_at: b.starts_at,
      };
      meetings.push(m);
      return m;
    },
  }).install(page);

  await page.goto("/conversations");
  await expect(page.getByText("1 new message from Gmail.")).toBeVisible();
  await page.getByRole("button", { name: /Douglas Quan/ }).click();
  await expect(page.getByText("Happy to! Coffee next week works.")).toBeVisible();

  await page.getByRole("button", { name: "Send Meet link" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Time" }).click();
  await page.getByRole("option", { name: /^9:30/ }).click();
  await expect(dialog.getByRole("textbox", { name: /Email to/ })).toHaveValue(/at 9:30/);
  await dialog.getByRole("button", { name: /Send Meet link/ }).click();

  await expect(page.getByText(/Meet link sent to Douglas Quan/)).toBeVisible();
  await expect(page.getByRole("link", { name: "meet.google.com/abc-defg-hij" })).toBeVisible();
  const sent = api.called("POST /api/conversations/3/meeting")[0].body as Record<string, unknown>;
  expect(sent).toMatchObject({ title: "Coffee chat with Douglas", duration_minutes: 30, calendar_invite: true });
  expect(new Date(sent.starts_at as string).getMinutes()).toBe(30);
  expect(sent.message).toContain("{{meet_link}}");
});

test("on a phone, a long last message doesn't make the page wider than the screen", async ({ page }) => {
  const waiting = {
    ...douglas, contact_id: 4, email: "priya.raman@example.com", full_name: "Priya Raman", replied: false, last_from_me: true,
    last_snippet: "Hi Priya, I came across your profile while looking into the company and was really interested in the work your team is doing on payments infrastructure",
  };
  await new FakeApi({
    "GET /api/gmail/status": { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true },
    "POST /api/conversations/sync": { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null },
    "GET /api/conversations": conversationsPage([douglas, waiting]),
    "GET /api/conversations/4": {
      ...waiting, meetings: [],
      messages: [{ id: "m1", from_me: true, from_name: null, from_addr: "me@gmail.com", to: waiting.email,
        subject: "Learning more about the payments infrastructure team and the work you are doing there", body: waiting.last_snippet,
        sent_at: "2026-10-04T19:08:00Z", gmail_thread_id: "t1" }],
    },
  }).install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.goto("/conversations");
  await expect(page.getByRole("button", { name: /Priya Raman/ })).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(390);

  // The conversation itself fits too.
  await page.getByRole("button", { name: /Priya Raman/ }).click();
  await expect(page.getByRole("button", { name: "Send Meet link" })).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(390);
});

test("scrolling to the end of the list loads the next people by itself", async ({ page }) => {
  const people = Array.from({ length: 45 }, (_, i) => ({ ...douglas, contact_id: 100 + i, email: `p${i}@example.com`, full_name: `Person ${i}` }));
  const api = await new FakeApi({
    "GET /api/gmail/status": { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true },
    "POST /api/conversations/sync": { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null },
    "GET /api/conversations": conversationsPage(people),
  }).install(page);
  await page.goto("/conversations");
  await expect(page.getByText("Showing 30 of 45")).toBeVisible();
  await expect(page.getByRole("button", { name: /Person 44/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Person 29/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /Person 44/ })).toBeAttached();
  await expect(page.getByText(/Showing \d+ of 45/)).toHaveCount(0);
  const offsets = api.called("GET /api/conversations").map((c) => c.url.searchParams.get("offset"));
  expect(offsets).toContain("30");
});
