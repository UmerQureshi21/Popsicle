import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GmailStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { api, apiError } from "@/test/server";
import Conversations from "./Conversations";
import { detail, meeting, msg, person } from "./fixtures";

const ALLOWED: GmailStatus = { connected: true, email: "me@gmail.com", credentials_file_present: true, can_read: true, can_meet: true };
const SEND_ONLY: GmailStatus = { ...ALLOWED, can_read: false, can_meet: false };

const PEOPLE = [
  person(),
  person({ contact_id: 4, email: "jane@stripe.com", full_name: null, linkedin_url: null, company_name: null, company_domain: null, replied: false, last_from_me: true,
    last_snippet: "Hi Jane, quick question", next_meeting_at: "2030-10-07T14:00:00Z", last_message_at: "2026-10-01T12:00:00Z" }),
];

function setup({ gmail = SEND_ONLY, people = PEOPLE }: { gmail?: GmailStatus | null; people?: typeof PEOPLE } = {}) {
  if (gmail) api("get", "/api/gmail/status", gmail);
  else apiError("get", "/api/gmail/status", 500);
  const list = api("get", "/api/conversations", people);
  render(<Conversations />);
  return { list, user: userEvent.setup() };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("Conversations: everyone emailed", () => {
  it("lists people with their last message, filters and searches", async () => {
    const { user } = setup();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Douglas Quan")).toBeInTheDocument();
    const jane = screen.getByRole("button", { name: /jane@stripe\.com/ });
    expect(jane).toHaveTextContent("You: Hi Jane, quick question");
    expect(jane).toHaveTextContent(formatDateTime("2030-10-07T14:00:00Z"));
    expect(screen.getByRole("button", { name: /Douglas Quan/ })).toHaveTextContent("IBM");
    expect(screen.getAllByLabelText("replied")).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All 2", "Replied 1", "No reply yet 1"]);

    await user.click(screen.getByRole("tab", { name: /Replied/ }));
    expect(screen.queryByRole("button", { name: /jane@stripe\.com/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /No reply yet/ }));
    expect(screen.queryByRole("button", { name: /Douglas Quan/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /All/ }));

    await user.type(screen.getByRole("textbox", { name: "Search people" }), "ibm");
    expect(screen.getByRole("button", { name: /Douglas Quan/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /jane@stripe\.com/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search people" }));
    await user.type(screen.getByRole("textbox", { name: "Search people" }), "nobody");
    expect(screen.getByText("Nobody matches.")).toBeInTheDocument();
    expect(screen.getByText("Pick someone to see your conversation.")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    setup({ people: [] });
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });

  it("shows why the list didn't load", async () => {
    apiError("get", "/api/conversations", 500, "Database is down");
    api("get", "/api/gmail/status", SEND_ONLY);
    render(<Conversations />);
    expect(await screen.findByText("Database is down")).toBeInTheDocument();
  });
});

describe("Conversations: Gmail permissions", () => {
  it("asks to connect Gmail when it isn't", async () => {
    setup({ gmail: { ...SEND_ONLY, connected: false } });
    const link = await screen.findByRole("link", { name: "Connect Gmail" });
    expect(link.getAttribute("href")).toMatch(/\/api\/gmail\/connect\?next=\/conversations$/);
    expect(screen.queryByText(/One more step/)).not.toBeInTheDocument();
  });

  it.each([
    [SEND_ONLY, "read your Gmail (to show replies) and manage calendar events"],
    [{ ...ALLOWED, can_read: false }, "let Popsicle read your Gmail to show replies."],
    [{ ...ALLOWED, can_meet: false }, "let Popsicle manage calendar events to make Google Meet links."],
  ])("asks for missing permissions", async (gmail, text) => {
    api("post", "/api/conversations/sync", { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null });
    setup({ gmail });
    expect(await screen.findByText(/One more step/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(text.replace(/[()]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect Gmail" }).getAttribute("href")).toContain("next=/conversations");
  });

  it("works without the Gmail status", async () => {
    setup({ gmail: null });
    expect(await screen.findByText("Douglas Quan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Gmail for replies" })).toBeDisabled();
  });
});

describe("Conversations: checking Gmail", () => {
  it("checks for replies on load and when asked", async () => {
    let n = 0;
    const sync = api("post", "/api/conversations/sync", () => ({ threads_checked: 3, threads_downloaded: 1, new_messages: n++ === 0 ? 2 : 1, synced_at: "2026-10-06T12:00:00Z" }));
    const { list, user } = setup({ gmail: ALLOWED });
    expect(await screen.findByText("2 new messages from Gmail.")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveLength(2));
    expect(screen.queryByText(/One more step/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check Gmail for replies" }));
    expect(await screen.findByText("1 new message from Gmail.")).toBeInTheDocument();
    expect(sync).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/new message/)).not.toBeInTheDocument();
  });

  it("says nothing when there's nothing new, and shows sync errors", async () => {
    let fail = false;
    api("post", "/api/conversations/sync", () =>
      fail ? Response.json({ detail: "Already checking Gmail." }, { status: 409 }) : { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null },
    );
    const { user } = setup({ gmail: ALLOWED });
    const button = await screen.findByRole("button", { name: "Check Gmail for replies" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText(/new message/)).not.toBeInTheDocument();
    fail = true;
    await user.click(button);
    expect(await screen.findByText("Already checking Gmail.")).toBeInTheDocument();
  });

  it("starting twice at once (React's development mode) checks Gmail once, without an error", async () => {
    const sync = api("post", "/api/conversations/sync", async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { threads_checked: 1, threads_downloaded: 1, new_messages: 3, synced_at: "2026-10-06T12:00:00Z" };
    });
    api("get", "/api/gmail/status", ALLOWED);
    api("get", "/api/conversations", PEOPLE);
    render(
      <StrictMode>
        <Conversations />
      </StrictMode>,
    );
    expect(await screen.findByText("3 new messages from Gmail.")).toBeInTheDocument();
    expect(sync).toHaveLength(1);
    expect(screen.queryByText(/Already checking/)).not.toBeInTheDocument();
  });

  it("waits for the check running in the background to finish", async () => {
    const posts = api("post", "/api/conversations/sync", { running: true, threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null });
    let polls = 0;
    api("get", "/api/conversations/sync", () =>
      ++polls < 2
        ? { running: true, threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null }
        : { running: false, threads_checked: 4, threads_downloaded: 2, new_messages: 3, synced_at: "2026-10-06T12:00:00Z", error: null },
    );
    setup({ gmail: ALLOWED });
    expect(await screen.findByText("3 new messages from Gmail.", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(polls).toBe(2);
  }, 10_000);

  it("shows why the background check failed", async () => {
    api("post", "/api/conversations/sync", { running: false, threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null,
      error: "Gmail error: Backend Error" });
    setup({ gmail: ALLOWED });
    expect(await screen.findByText("Gmail error: Backend Error")).toBeInTheDocument();
  });

  it("shows Checking… while it runs", async () => {
    api("post", "/api/conversations/sync", () => new Promise(() => {}));
    setup({ gmail: ALLOWED });
    expect(await screen.findByText("Checking Gmail for replies…")).toBeInTheDocument();
  });
});

describe("Conversations: one person", () => {
  it("shows the whole conversation and goes back", async () => {
    const calls = api("get", "/api/conversations/3", detail({ meetings: [
      meeting(),
      meeting({ id: 2, title: "Earlier call", starts_at: "2026-09-01T14:00:00Z", ends_at: "2026-09-01T14:30:00Z", calendar_url: null }),
    ] }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    expect(await screen.findByText("Hi Douglas, would you have 30 minutes?")).toBeInTheDocument();
    expect(screen.getAllByText("Coffee next week works!").length).toBeGreaterThan(0);
    // The subject shows once: the reply continues the same conversation.
    expect(screen.getAllByText(/Coffee chat Request/)).toHaveLength(1);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("Douglas Quan").length).toBeGreaterThan(1);
    expect(screen.getByText(/Software Engineer · IBM ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn profile" })).toHaveAttribute("href", "https://linkedin.com/in/dq");
    expect(screen.getByRole("link", { name: /Reply in Gmail/ }).getAttribute("href")).toContain("douglas.quan%40ibm.com");
    expect(calls).toHaveLength(1);

    // Meetings: the upcoming one, and one that's done.
    expect(screen.getByText("Coffee chat with Douglas")).toBeInTheDocument();
    expect(screen.getByText(/· done/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "meet.google.com/abc-defg-hij" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open in Google Calendar" })).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: "Copy Meet link" })[0]);
    expect(await navigator.clipboard.readText()).toBe("https://meet.google.com/abc-defg-hij");

    await user.click(screen.getByRole("button", { name: "Back to everyone" }));
    expect(screen.getByText("Pick someone to see your conversation.")).toBeInTheDocument();
  });

  it("dangerous links from data are never clickable", async () => {
    api("get", "/api/conversations/3", detail({ linkedin_url: "javascript:alert(1)",
      meetings: [meeting({ meet_url: "javascript:alert(1)", calendar_url: "javascript:alert(2)" })] }));
    const { user } = setup({ people: [person({ linkedin_url: "javascript:alert(1)" })] });
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    await screen.findByText("Coffee chat with Douglas");
    expect(screen.queryByRole("link", { name: "LinkedIn profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in Google Calendar" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("says when they haven't replied, and why it might be", async () => {
    api("get", "/api/conversations/4", detail({ ...PEOPLE[1], messages: [msg({ subject: "" })], replied: false }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /jane@stripe\.com/ }));
    expect(await screen.findByText("No reply yet (or Popsicle can’t read your Gmail yet).")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "LinkedIn profile" })).not.toBeInTheDocument();
  });

  it("with Gmail readable, no reply is just no reply", async () => {
    api("post", "/api/conversations/sync", { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null });
    api("get", "/api/conversations/4", detail({ ...PEOPLE[1], messages: [msg()], replied: false }));
    const { user } = setup({ gmail: ALLOWED });
    await user.click(await screen.findByRole("button", { name: /jane@stripe\.com/ }));
    expect(await screen.findByText("No reply yet.")).toBeInTheDocument();
  });

  it("copying can fail quietly", async () => {
    api("get", "/api/conversations/3", detail({ meetings: [meeting()] }));
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    await user.click(await screen.findByRole("button", { name: "Copy Meet link" }));
    expect(screen.getByRole("button", { name: "Copy Meet link" })).toBeInTheDocument();
  });

  it("opens the person from the address bar, and says Gmail was reconnected", async () => {
    window.history.replaceState(null, "", "/conversations?contact=3&gmail=connected");
    api("get", "/api/conversations/3", () => new Promise(() => {}));
    setup();
    expect(await screen.findByText(/Gmail connected/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    const header = await screen.findByRole("button", { name: "Send Meet link" });
    expect(header).toBeDisabled(); // still loading
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("shows Loading… until the person is found", async () => {
    window.history.replaceState(null, "", "/conversations?contact=99");
    api("get", "/api/conversations/99", () => new Promise(() => {}));
    setup();
    await screen.findByText("Douglas Quan");
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("shows why a conversation didn't load", async () => {
    apiError("get", "/api/conversations/3", 404, "You haven't emailed this person yet.");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    expect(await screen.findByText("You haven't emailed this person yet.")).toBeInTheDocument();
  });

  it("sends a Meet link and shows it", async () => {
    let meetings = [] as ReturnType<typeof meeting>[];
    api("post", "/api/conversations/sync", { threads_checked: 0, threads_downloaded: 0, new_messages: 0, synced_at: null });
    api("get", "/api/conversations/3", () => detail({ meetings }));
    api("post", "/api/conversations/3/meeting", () => {
      meetings = [meeting()];
      return meetings[0];
    });
    const { user } = setup({ gmail: ALLOWED });
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    await user.click(await screen.findByRole("button", { name: "Send Meet link" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Send Meet link/ }));
    expect(await screen.findByText(/Meet link sent to Douglas Quan for/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Coffee chat with Douglas")).toBeInTheDocument();
  });

  it("closes the Meet dialog", async () => {
    api("get", "/api/conversations/3", detail());
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Douglas Quan/ }));
    await user.click(await screen.findByRole("button", { name: "Send Meet link" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
