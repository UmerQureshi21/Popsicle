import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BookingSettings } from "@/lib/api";
import { timeZone } from "@/lib/meet";
import { api, apiError } from "@/test/server";
import BookingHours from "./BookingHours";

const OFF: BookingSettings = {
  enabled: false, host_name: "", time_zone: "America/Toronto", weekdays: [0, 1, 2, 3, 4],
  day_start: 540, day_end: 1020, notice_hours: 24, days_ahead: 14, can_check_calendar: true,
};

async function openForm(settings: BookingSettings = OFF) {
  api("get", "/api/booking/settings", settings);
  render(<BookingHours />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Booking hours/ }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("Booking hours", () => {
  it("says whether bookings are on", async () => {
    api("get", "/api/booking/settings", { ...OFF, enabled: true, host_name: "Umer" });
    render(<BookingHours />);
    expect(await screen.findByRole("button", { name: /Booking hours/ })).toHaveTextContent("On");
  });

  it("can't open until the settings load", async () => {
    apiError("get", "/api/booking/settings", 500);
    render(<BookingHours />);
    expect(screen.getByRole("button", { name: /Booking hours/ })).toBeDisabled();
  });

  // Many clicks over a ~400-option time zone list: slow when every test file runs at once.
  it("turns bookings on with your name, days, hours, notice and range", { timeout: 15_000 }, async () => {
    const saved = api("put", "/api/booking/settings", ({ body }) => ({ ...(body as object), can_check_calendar: true }));
    const { user, dialog } = await openForm();
    // A first-time setup starts in your own time zone.
    expect(within(dialog).getByRole("combobox", { name: "Time zone" })).toHaveValue(timeZone());

    await user.click(within(dialog).getByRole("checkbox", { name: "Take bookings" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Your name" }), "Umer");
    await user.click(within(dialog).getByRole("button", { name: "Fri" }));
    await user.click(within(dialog).getByRole("button", { name: "Sat" }));
    await user.click(within(dialog).getByRole("button", { name: "From" }));
    await user.click(screen.getByRole("option", { name: "10:00 AM" }));
    await user.click(within(dialog).getByRole("button", { name: "Until" }));
    await user.click(screen.getByRole("option", { name: "4:00 PM" }));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Time zone" }), "Europe/London");
    await user.click(within(dialog).getByRole("button", { name: "Notice" }));
    await user.click(screen.getByRole("option", { name: "2 hours" }));
    await user.click(within(dialog).getByRole("button", { name: "Up to" }));
    await user.click(screen.getByRole("option", { name: "30 days" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(saved[0].body).toEqual({
      enabled: true, host_name: "Umer", time_zone: "Europe/London", weekdays: [0, 1, 2, 3, 5],
      day_start: 600, day_end: 960, notice_hours: 2, days_ahead: 30,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Booking hours/ })).toHaveTextContent("On");
  });

  it("keeps your saved time zone once set up", async () => {
    const { dialog } = await openForm({ ...OFF, enabled: true, host_name: "Umer", time_zone: "Asia/Tokyo" });
    expect(within(dialog).getByRole("combobox", { name: "Time zone" })).toHaveValue("Asia/Tokyo");
    expect(within(dialog).getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows why it couldn't save, and can be closed", async () => {
    apiError("put", "/api/booking/settings", 422, [{ msg: "Value error, Add your name: it's shown on the booking page." }]);
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole("checkbox", { name: "Take bookings" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Add your name: it's shown on the booking page.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks to reconnect Gmail when it can't see your calendar", async () => {
    const { dialog } = await openForm({ ...OFF, can_check_calendar: false });
    expect(within(dialog).getByText(/can’t see your Google Calendar yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Reconnect Gmail" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/gmail/connect?next=/conversations"),
    );
  });
});
