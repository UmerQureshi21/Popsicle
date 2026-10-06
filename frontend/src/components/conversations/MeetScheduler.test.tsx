import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GmailStatus } from "@/lib/api";
import { combine, describeWhen, nextWeekday, timeZone, toDateInput } from "@/lib/meet";
import { api, apiError } from "@/test/server";
import MeetScheduler from "./MeetScheduler";
import { meeting, person } from "./fixtures";

const ALLOWED: GmailStatus = { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true };

function setup(gmail: GmailStatus | null = ALLOWED) {
  const onClose = vi.fn();
  const onScheduled = vi.fn();
  render(<MeetScheduler person={person()} gmail={gmail} onClose={onClose} onScheduled={onScheduled} />);
  return { onClose, onScheduled, user: userEvent.setup() };
}

const message = () => screen.getByRole("textbox", { name: /Email to douglas\.quan@ibm\.com/ }) as HTMLTextAreaElement;

describe("MeetScheduler", () => {
  it("defaults to a 30-minute coffee chat on the next weekday at 10, and sends it", async () => {
    const calls = api("post", "/api/conversations/3/meeting", meeting(), 201);
    const { onScheduled, user } = setup();
    const day = toDateInput(nextWeekday());
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Coffee chat with Douglas");
    expect(screen.getByLabelText("Date")).toHaveValue(day);
    expect(screen.getByRole("button", { name: "Time" })).toHaveTextContent(/10:00/);
    expect(screen.getByRole("button", { name: "Length" })).toHaveTextContent("30 minutes");
    expect(message().value).toContain(`for ${describeWhen(combine(day, "10:00")!)}:`);
    expect(screen.getByRole("checkbox", { name: /Google Calendar invite/ })).toBeChecked();
    expect(screen.getByText(`Your time (${timeZone()}).`, { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send Meet link/ }));
    await waitFor(() => expect(onScheduled).toHaveBeenCalledWith(meeting()));
    expect(calls[0].body).toEqual({
      title: "Coffee chat with Douglas",
      starts_at: combine(day, "10:00")!.toISOString(),
      duration_minutes: 30,
      time_zone: timeZone(),
      message: message().value,
      calendar_invite: true,
    });
  });

  it("the email follows the chosen time until you edit it", async () => {
    const calls = api("post", "/api/conversations/3/meeting", meeting(), 201);
    const { user } = setup();
    const day = toDateInput(nextWeekday());
    await user.click(screen.getByRole("button", { name: "Time" }));
    await user.click(screen.getByRole("option", { name: /^2:30/ }));
    expect(message().value).toContain(describeWhen(combine(day, "14:30")!));
    await user.click(screen.getByRole("button", { name: "Length" }));
    await user.click(screen.getByRole("option", { name: "45 minutes" }));

    await user.clear(message());
    await user.type(message(), "See you then: {{{{meet_link}}");
    await user.click(screen.getByRole("button", { name: "Time" }));
    await user.click(screen.getByRole("option", { name: /^3:00/ }));
    expect(message()).toHaveValue("See you then: {{meet_link}}");

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Chat ");
    await user.click(screen.getByRole("checkbox", { name: /Google Calendar invite/ }));
    await user.click(screen.getByRole("button", { name: /Send Meet link/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ title: "Chat", duration_minutes: 45, message: "See you then: {{meet_link}}", calendar_invite: false });

    await user.click(screen.getByRole("button", { name: "Reset text" }));
    expect(message().value).toContain("Hi Douglas,");
  });

  it("only a future time can be sent", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2020-01-01" } });
    expect(screen.getByText("Pick a time in the future.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    expect(screen.queryByText("Pick a time in the future.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeDisabled();
    expect(message().value).toContain("Here’s the Google Meet link:");
  });

  it("needs a title", async () => {
    const { user } = setup();
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeDisabled();
  });

  it("shows Sending… and then why it failed", async () => {
    let fail: (r: Response) => void = () => {};
    api("post", "/api/conversations/3/meeting", () => new Promise<Response>((r) => (fail = r)));
    const { onScheduled, user } = setup();
    await user.click(screen.getByRole("button", { name: /Send Meet link/ }));
    expect(screen.getByRole("button", { name: /Sending…/ })).toBeDisabled();
    fail(Response.json({ detail: "Turn on the Google Calendar API for your Google Cloud project" }, { status: 400 }));
    expect(await screen.findByText(/Turn on the Google Calendar API/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeEnabled();
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it("asks for calendar permission when it's missing", () => {
    setup({ ...ALLOWED, can_meet: false });
    expect(screen.getByText(/needs permission to create Google Calendar events/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect Gmail" }).getAttribute("href")).toContain("/api/gmail/connect?next=/conversations");
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeDisabled();
  });

  it("without the Gmail status, it can't send either", () => {
    setup(null);
    expect(screen.getByRole("button", { name: /Send Meet link/ })).toBeDisabled();
  });

  it("cancels", async () => {
    apiError("post", "/api/conversations/3/meeting", 500);
    const { onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
