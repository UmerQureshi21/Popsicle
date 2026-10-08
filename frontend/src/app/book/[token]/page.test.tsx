import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BookingPage } from "@/lib/api";
import { api, apiError } from "@/test/server";
import BookPage from "./page";

const TOKEN = "k3J9abc";
const PAGE: BookingPage = {
  host_name: "Umer",
  first_name: "Douglas",
  minutes: 30,
  time_zone: "America/Toronto",
  // Two days, in the test's own time zone (whatever the machine uses): noon and 12:30 on one, noon on the next.
  slots: [new Date(2030, 9, 8, 12).toISOString(), new Date(2030, 9, 8, 12, 30).toISOString(), new Date(2030, 9, 9, 12).toISOString()],
  booked: null,
};

function open(token = TOKEN) {
  window.history.replaceState(null, "", `/book/${token}`);
  render(<BookPage />);
  return userEvent.setup();
}

describe("the booking page", () => {
  it("shows the open times by day and books the one picked", async () => {
    api("get", `/api/book/${TOKEN}`, PAGE);
    const booked = api("post", `/api/book/${TOKEN}`, ({ body }) => ({
      starts_at: (body as { starts_at: string }).starts_at,
      ends_at: new Date(2030, 9, 9, 12, 30).toISOString(),
    }));
    const user = open();
    expect(screen.getByText("Loading open times…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Book a call with Umer" })).toBeInTheDocument();
    expect(screen.getByText(/Hi Douglas, pick a 30-minute time/)).toBeInTheDocument();

    const days = screen.getAllByRole("tab");
    expect(days.map((d) => d.textContent)).toEqual(["Tuesday, October 8", "Wednesday, October 9"]);
    expect(days[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(["12:00 PM", "12:30 PM"]);
    expect(screen.getByRole("button", { name: "Pick a time" })).toBeDisabled();

    await user.click(days[1]);
    await user.click(screen.getByRole("button", { name: "12:00 PM" }));
    await user.click(screen.getByRole("button", { name: "Book Wednesday, October 9 at 12:00 PM" }));

    expect(await screen.findByRole("heading", { name: "You’re booked with Umer" })).toBeInTheDocument();
    expect(screen.getByText("Wednesday, October 9, 12:00 PM – 12:30 PM", { exact: false })).toBeInTheDocument();
    expect(booked[0].body).toEqual({ starts_at: PAGE.slots[2] });
  });

  it("offers what's left when the time was just taken", async () => {
    let page = PAGE;
    api("get", `/api/book/${TOKEN}`, () => page);
    api("post", `/api/book/${TOKEN}`, () => {
      page = { ...PAGE, slots: [PAGE.slots[1]] };
      return new Response(JSON.stringify({ detail: "That time isn't free anymore. Pick another one." }), { status: 409 });
    });
    const user = open();
    await user.click(await screen.findByRole("button", { name: "12:00 PM" }));
    await user.click(screen.getByRole("button", { name: /^Book / }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That time isn't free anymore. Pick another one.");
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "12:00 PM" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick a time" })).toBeDisabled();
  });

  it("shows a booking already made", async () => {
    api("get", `/api/book/${TOKEN}`, { ...PAGE, slots: [], booked: { starts_at: PAGE.slots[0], ends_at: PAGE.slots[1] } });
    open();
    expect(await screen.findByRole("heading", { name: "You’re booked with Umer" })).toBeInTheDocument();
    expect(screen.getByText(/Tuesday, October 8, 12:00 PM – 12:30 PM/)).toBeInTheDocument();
  });

  it("still says booked when the call was deleted since", async () => {
    api("get", `/api/book/${TOKEN}`, { ...PAGE, slots: [], booked: { starts_at: null, ends_at: null } });
    open();
    expect(await screen.findByRole("heading", { name: "You’re booked with Umer" })).toBeInTheDocument();
    expect(screen.queryByText(/October/)).not.toBeInTheDocument();
  });

  it("explains a link that doesn't work", async () => {
    apiError("get", "/api/book/old", 404, "This booking link doesn't work anymore. Reply to the email to find a time.");
    open("old");
    expect(await screen.findByRole("heading", { name: "This link isn’t available" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("doesn't work anymore");
  });

  it("says when there are no open times", async () => {
    api("get", `/api/book/${TOKEN}`, { ...PAGE, slots: [] });
    open();
    expect(await screen.findByText(/There are no open times right now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick a time" })).not.toBeInTheDocument();
  });
});
