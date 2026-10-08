import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignSummary, Company, Contact } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { campaign, email, hunterStatus, quota } from "@/test/fixtures";
import { navigation } from "@/test/navigation";
import { api, apiError, quietDefaults } from "@/test/server";
import ComposePage from "./compose/page";
import ContactsPage from "./contacts/page";
import ConversationsPage from "./conversations/page";
import FindPeoplePage from "./find/page";
import LoginPage from "./login/page";
import LookupPage from "./lookup/page";
import SentPage from "./sent/page";
import { formatDateTime } from "@/lib/format";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const company = (overrides: Partial<Company> = {}): Company => ({
  id: 1, name: "Stripe", domain: "stripe.com", linkedin_url: null, notes: null, created_at: "2026-09-01T12:00:00Z",
  contact_count: 2, emailed_count: 1, last_sent_at: "2026-10-01T12:00:00Z", status: "emailed", ...overrides,
});

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 1, email: "jane@stripe.com", full_name: "Jane Doe", first_name: "Jane", last_name: "Doe", title: "Engineer",
  linkedin_url: "https://linkedin.com/in/jane", notes: null, company_id: 1, company_name: "Stripe",
  created_at: "2026-09-01T12:00:00Z", sent_count: 2, last_sent_at: "2026-10-01T12:00:00Z", last_status: "sent", ...overrides,
});

describe("Contacts page", () => {
  it("lists contacts, searches, filters by company and removes", async () => {
    api("get", "/api/companies", [company()]);
    let list = [contact(), contact({ id: 2, email: "sam@x.com", full_name: null, title: null, linkedin_url: null, company_name: null, sent_count: 0, last_status: null })];
    const calls = api("get", "/api/contacts", () => list);
    api("delete", "/api/contacts/1", () => {
      list = list.slice(1);
      return new Response(null, { status: 204 });
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<ContactsPage />);
    const user = userEvent.setup();

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Unknown name")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(screen.getByText(/2×/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search name, email or title"), " jane ");
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get("q")).toBe("jane"));
    await user.click(screen.getByRole("button", { name: "Filter by company" }));
    await user.click(screen.getByRole("option", { name: "Stripe" }));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get("company_id")).toBe("1"));

    const [removeJane] = screen.getAllByRole("button", { name: "Remove contact" });
    await user.click(removeJane);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    await user.click(removeJane);
    await waitFor(() => expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument());
    expect(confirm).toHaveBeenLastCalledWith("Remove Jane Doe? Their sent emails stay in history.");
  });

  it("empty states", async () => {
    api("get", "/api/companies", { detail: "down" }, 500);
    api("get", "/api/contacts", []);
    render(<ContactsPage />);
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    await userEvent.setup().type(screen.getByPlaceholderText("Search name, email or title"), "zzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("treats a failed load as no contacts", async () => {
    api("get", "/api/companies", []);
    apiError("get", "/api/contacts", 500);
    render(<ContactsPage />);
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
  });

  it("removing someone without a name uses their email", async () => {
    api("get", "/api/companies", []);
    api("get", "/api/contacts", [contact({ full_name: null })]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ContactsPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Remove contact" }));
    expect(confirm).toHaveBeenCalledWith("Remove jane@stripe.com? Their sent emails stay in history.");
  });
});

describe("Sent page", () => {
  // Every Sent page load asks for the daily-limit card; tests that care set their own answer.
  beforeEach(() => {
    api("get", "/api/sending/quota", quota());
  });

  it("shows the daily limit card", async () => {
    api("get", "/api/stats", { sent_total: 6, sent_last_7_days: 6, companies: 1, contacts: 6, failed_total: 0 });
    api("get", "/api/campaigns", []);
    render(<SentPage />);
    expect(await screen.findByText("6 of 40 sent in the last 24 hours")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sending safety" })).toBeInTheDocument();
  });

  const summary = (overrides: Partial<CampaignSummary> = {}): CampaignSummary => {
    const { subject_template, body_template, variables, attachments, emails, ...rest } = campaign({ status: "completed", ...overrides });
    void [subject_template, body_template, variables, attachments, emails];
    return rest;
  };

  it("shows stats and batches, and opens one", async () => {
    api("get", "/api/stats", { sent_total: 12, sent_last_7_days: 3, companies: 2, contacts: 9, failed_total: 1 });
    api("get", "/api/campaigns", [summary({ counts: { total: 3, pending: 0, sent: 1, failed: 1, skipped: 1, cancelled: 0 } }), summary({ id: 8, name: "Solo", counts: { total: 1, pending: 0, sent: 1, failed: 0, skipped: 0, cancelled: 0 } })]);
    api("get", "/api/campaigns/7", campaign({ status: "completed", finished_at: "2026-10-01T12:05:00Z", emails: [email({ status: "sent", sent_at: "2026-10-01T12:00:00Z" })] }));
    render(<SentPage />);
    const user = userEvent.setup();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("1/2 sent")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText(/1 recipient ·/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Stripe/ }));
    expect(await screen.findByText("Template used")).toBeInTheDocument();
    expect(screen.getByText("(full_name, email)")).toBeInTheDocument();
    expect(screen.getByText(/· finished/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Stripe/ }));
    expect(screen.queryByText("Template used")).not.toBeInTheDocument();
  });

  it("a scheduled batch says when it sends", async () => {
    api("get", "/api/stats", { sent_total: 0, sent_last_7_days: 0, companies: 1, contacts: 1, failed_total: 0 });
    api("get", "/api/campaigns", [summary({ status: "scheduled", scheduled_for: "2026-10-07T13:00:00Z" })]);
    render(<SentPage />);
    expect(await screen.findByText(`1 recipient · sends ${formatDateTime("2026-10-07T13:00:00Z")}`)).toBeInTheDocument();
    expect(screen.getByText("scheduled", { selector: "span.inline-flex" })).toBeInTheDocument();
  });

  it("shows Loading… while a batch opens", async () => {
    api("get", "/api/stats", { detail: "x" }, 500);
    api("get", "/api/campaigns", [summary()]);
    api("get", "/api/campaigns/7", () => new Promise(() => {}));
    render(<SentPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /^Stripe/ }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getAllByText("–")).toHaveLength(4);
  });

  it("deletes a finished batch after confirming, and shows delete errors", async () => {
    let list = [summary()];
    api("get", "/api/stats", { sent_total: 0, sent_last_7_days: 0, companies: 0, contacts: 0, failed_total: 0 });
    api("get", "/api/campaigns", () => list);
    api("get", "/api/campaigns/7", campaign({ status: "completed", emails: [] }));
    let fail = true;
    api("delete", "/api/campaigns/7", () => {
      if (fail) return Response.json({ detail: "Cancel the campaign before deleting it." }, { status: 409 });
      list = [];
      return new Response(null, { status: 204 });
    });
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<SentPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Stripe/ }));
    const del = await screen.findByRole("button", { name: /Delete/ });
    await user.click(del); // not confirmed
    await user.click(del);
    expect(await screen.findByText("Cancel the campaign before deleting it.")).toBeInTheDocument();
    fail = false;
    await user.click(del);
    expect(await screen.findByText("Nothing sent yet")).toBeInTheDocument();
  });

  it("refreshes while a batch is sending, and when it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status: "sending" | "completed" = "sending";
    api("get", "/api/stats", { sent_total: 0, sent_last_7_days: 0, companies: 0, contacts: 0, failed_total: 0 });
    const list = api("get", "/api/campaigns", () => [summary({ status })]);
    api("get", "/api/campaigns/7", () => campaign({ status }));
    render(<SentPage />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: /^Stripe/ }));
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument(); // can't delete while sending

    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(list.length).toBeGreaterThanOrEqual(2);
    status = "completed";
    const before = list.length;
    await act(() => vi.advanceTimersByTimeAsync(1600)); // the progress view polls and sees it finish
    await waitFor(() => expect(list.length).toBeGreaterThan(before));
  });

  it("shows a load error", async () => {
    api("get", "/api/stats", {});
    apiError("get", "/api/campaigns", 500, "Database is down");
    render(<SentPage />);
    expect(await screen.findByText("Database is down")).toBeInTheDocument();
  });
});

describe("Login page", () => {
  function renderLogin(me = { user: null, auth_required: true }) {
    navigation.pathname = "/login";
    api("get", "/api/auth/me", me);
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    return userEvent.setup();
  }

  it("logs in and goes to the page you asked for", async () => {
    window.history.replaceState(null, "", "/login?next=/find");
    const login = api("post", "/api/auth/login", { email: "me@x.com", name: null });
    const user = renderLogin();
    await user.type(await screen.findByPlaceholderText("you@example.com"), "me@x.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/find"));
    expect(login[0].body).toEqual({ email: "me@x.com", password: "correct horse" });
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\\/evil.example", "/login", "/login?x=1", "find", "http://["])("never redirects to %s", async (next) => {
    window.history.replaceState(null, "", `/login?next=${encodeURIComponent(next)}`);
    api("post", "/api/auth/login", { email: "me@x.com", name: null });
    const user = renderLogin();
    await user.type(await screen.findByPlaceholderText("you@example.com"), "me@x.com");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/compose"));
  });

  it("shows a wrong password", async () => {
    apiError("post", "/api/auth/login", 401, "That email and password don't match an account.");
    const user = renderLogin();
    await user.type(await screen.findByPlaceholderText("you@example.com"), "me@x.com");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match an account.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("has sign-ups closed: the form is disabled and never reaches the server", async () => {
    const signup = api("post", "/api/auth/signup", { email: "stranger@x.com", name: null });
    const login = api("post", "/api/auth/login", { email: "stranger@x.com", name: null });
    const user = renderLogin();
    await user.click(await screen.findByRole("tab", { name: "Sign up" }));
    expect(screen.getByRole("heading", { name: "Sign-ups are closed" })).toBeInTheDocument();
    expect(screen.getByText(/Popsicle is invite-only/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Create account" });
    expect(button).toBeDisabled();

    // Even if the form is submitted another way (Enter, or the button re-enabled in devtools).
    button.removeAttribute("disabled");
    fireEvent.submit(button.closest("form")!);
    await user.click(button);
    expect(signup).toHaveLength(0);
    expect(login).toHaveLength(0);
    expect(navigation.router.replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Log in" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeEnabled();
  });

  it("skips the page when already logged in", async () => {
    renderLogin({ user: { email: "me@x.com", name: null } as never, auth_required: true });
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/compose"));
  });

  it("locally, offers to continue without logging in", async () => {
    renderLogin({ user: null, auth_required: false });
    expect(await screen.findByRole("link", { name: "Continue without logging in" })).toHaveAttribute("href", "/compose");
  });
});

describe("pages that render in the browser only", () => {
  it("Compose", async () => {
    quietDefaults();
    render(<ComposePage />);
    expect(await screen.findByText("New email")).toBeInTheDocument();
  });

  it("Find people", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    render(<FindPeoplePage />);
    expect(screen.getByRole("heading", { name: "Find people" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Add a company" })).toBeInTheDocument();
  });

  it("Look up", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    render(<LookupPage />);
    expect(screen.getByRole("heading", { name: "Look up a person" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Find email" })).toBeInTheDocument();
  });

  it("Inbox", async () => {
    api("get", "/api/gmail/status", { connected: true, email: "me@gmail.com", credentials_file_present: true });
    api("get", "/api/conversations", []);
    render(<ConversationsPage />);
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });
});
