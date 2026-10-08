import { expect, test } from "@playwright/test";
import { BOOKING_OFF, FakeApi } from "./fake-api";

// Everything here is answered by FakeApi in the browser: nothing reaches Gmail or Google Calendar.

const douglas = {
  contact_id: 3, email: "douglas.quan@ibm.com", full_name: "Douglas Quan", title: null, linkedin_url: null,
  company_name: "IBM", company_domain: null, first_emailed_at: "2026-10-04T19:08:00Z", last_message_at: "2026-10-05T14:00:00Z",
  last_snippet: "Coffee next week works!", last_from_me: false, replied: true, message_count: 1, next_meeting_at: null,
};

test("someone you emailed books a call from their link, without logging in", async ({ page }) => {
  // Noon and 12:30 tomorrow, in whatever time zone the browser uses (the page shows its own).
  const day = new Date();
  day.setDate(day.getDate() + 1);
  const at = (h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();
  const api = await new FakeApi({
    "GET /api/auth/me": { user: null, auth_required: true },
    "GET /api/book/k3J9abc": { host_name: "Umer", first_name: "Douglas", minutes: 30, time_zone: "America/Toronto", slots: [at(12), at(12, 30)], booked: null },
    "POST /api/book/k3J9abc": (body) => ({ starts_at: (body as { starts_at: string }).starts_at, ends_at: at(13) }),
  }).install(page);

  await page.goto("/book/k3J9abc");
  await expect(page.getByRole("heading", { name: "Book a call with Umer" })).toBeVisible();
  await expect(page).toHaveURL(/\/book\/k3J9abc$/); // not sent to log in
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  await page.getByRole("button", { name: "12:30 PM" }).click();
  await page.getByRole("button", { name: /^Book .* at 12:30 PM$/ }).click();
  await expect(page.getByRole("heading", { name: "You’re booked with Umer" })).toBeVisible();
  await expect(page.getByText(/12:30 PM – 1:00 PM/)).toBeVisible();
  expect(api.called("POST /api/book/k3J9abc")[0].body).toEqual({ starts_at: at(12, 30) });
});

test("turn on booking hours and send someone their link", async ({ page }) => {
  let settings = BOOKING_OFF;
  const api = await new FakeApi({
    "GET /api/gmail/status": { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true },
    "POST /api/conversations/sync": { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null },
    "GET /api/conversations": [douglas],
    "GET /api/conversations/3": { ...douglas, meetings: [], messages: [] },
    "GET /api/booking/settings": () => settings,
    "PUT /api/booking/settings": (body) => (settings = { ...(body as typeof BOOKING_OFF), can_check_calendar: true }),
    "POST /api/conversations/3/booking-link": { url: "https://popsicle.example/book/abc", expires_at: "2030-12-01T00:00:00Z" },
  }).install(page);

  await page.goto("/conversations");
  await page.getByRole("button", { name: /Booking hours/ }).click();
  const hours = page.getByRole("dialog");
  await hours.getByRole("checkbox", { name: "Take bookings" }).check();
  await hours.getByRole("textbox", { name: "Your name" }).fill("Umer");
  await hours.getByRole("button", { name: "Fri" }).click();
  await hours.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /Booking hours/ })).toContainText("On");
  expect(api.called("PUT /api/booking/settings")[0].body).toMatchObject({ enabled: true, host_name: "Umer", weekdays: [0, 1, 2, 3] });

  await page.getByRole("button", { name: /Douglas Quan/ }).click();
  await page.getByRole("button", { name: "Send booking link" }).click();
  const send = page.getByRole("dialog");
  await expect(send.getByRole("textbox", { name: /Email to/ })).toHaveValue(/\{\{booking_link\}\}/);
  await send.getByRole("button", { name: /Send booking link/ }).click();
  await expect(page.getByText(/Booking link sent to Douglas Quan/)).toBeVisible();
  expect((api.called("POST /api/conversations/3/booking-link")[0].body as { message: string }).message).toContain("Hi Douglas,");
});
