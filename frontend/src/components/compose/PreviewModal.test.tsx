import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft, GmailStatus, Preview, PreviewItem, Verification } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { quickPicks, toLocalInput } from "@/lib/schedule";
import { campaign, hunterStatus, quota } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import PreviewModal, { VerificationBadge } from "./PreviewModal";

const DRAFT: CampaignDraft = {
  company: "Stripe",
  subject: "Hi {{first_name}}",
  body: "Hello",
  variables: ["full_name", "email"],
  rows: [{ full_name: "Jane", email: "jane@stripe.com" }],
  attachment_ids: [],
  skip_already_sent: true,
  delay_seconds: 30,
};

const CONNECTED: GmailStatus = { connected: true, email: "me@gmail.com", credentials_file_present: true };

const item = (overrides: Partial<PreviewItem> = {}): PreviewItem => ({
  index: 0,
  to_email: "jane@stripe.com",
  subject: "Hi Jane",
  body: "Hello Jane",
  values: { full_name: "Jane Doe", email: "jane@stripe.com" },
  status: "ready",
  issues: [],
  last_sent_at: null,
  ...overrides,
});

const preview = (items: PreviewItem[], overrides: Partial<Preview> = {}): Preview => {
  const ready = items.filter((i) => i.status === "ready").length;
  return {
    items,
    ready,
    already_sent: items.filter((i) => i.status === "already_sent").length,
    invalid: items.filter((i) => i.status === "invalid").length,
    undeliverable: items.filter((i) => i.status === "undeliverable").length,
    quota: quota(),
    sends_now: ready,
    sends_later: 0,
    later_from: null,
    ...overrides,
  };
};

function setup(items: PreviewItem[], gmail: GmailStatus | null = CONNECTED, attachments = [] as React.ComponentProps<typeof PreviewModal>["attachments"]) {
  const calls = api("post", "/api/campaigns/preview", preview(items));
  const onSent = vi.fn();
  const onClose = vi.fn();
  render(<PreviewModal draft={DRAFT} attachments={attachments} gmail={gmail} onClose={onClose} onSent={onSent} />);
  return { calls, onSent, onClose, user: userEvent.setup() };
}

describe("PreviewModal", () => {
  // The review screen reads Hunter's status for the verifications left.
  beforeEach(() => {
    api("get", "/api/people-search/status", hunterStatus({ verifications_total: 100, verifications_remaining: 94 }));
  });

  it("renders each email and sends them", async () => {
    const sent = campaign();
    const create = api("post", "/api/campaigns", sent, 201);
    const { calls, onSent, user } = setup([item()], CONNECTED, [{ id: 1, filename: "resume.pdf", content_type: "application/pdf", size_bytes: 10, created_at: "" }]);
    expect(screen.getByText("Rendering…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hi Jane" })).toBeInTheDocument();
    expect(screen.getByText("Hello Jane")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText(/ready · ~30s between emails/)).toBeInTheDocument();
    expect(calls[0].body).toEqual(DRAFT);

    await user.click(screen.getByRole("button", { name: /Send 1 email$/ }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(sent));
    expect(create[0].body).toEqual(DRAFT);
  });

  it("steps through recipients", async () => {
    const { user } = setup([
      item(),
      item({ index: 1, to_email: "sam@x.com", subject: "Hi Sam", values: { email: "sam@x.com" }, status: "already_sent", last_sent_at: "2026-03-01T12:00:00Z" }),
      item({ index: 2, to_email: "", values: {}, status: "invalid", issues: ["missing email", "no value for first_name"] }),
    ]);
    await screen.findByRole("heading", { name: "Hi Jane" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByText(/1 already emailed \(skipped\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 need fixing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send 1 email/ })).toBeDisabled(); // an invalid row blocks sending

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/You already emailed this person on Mar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("missing email · no value for first_name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await user.click(screen.getByRole("button", { name: /^sam@x\.com/ }));
    expect(screen.getByRole("heading", { name: "Hi Sam" })).toBeInTheDocument();
    expect(screen.getByText("(no email)")).toBeInTheDocument();
  });

  it("asks you to connect Gmail first", async () => {
    setup([item(), item({ index: 1 })], { connected: false, email: null, credentials_file_present: true });
    expect(await screen.findByText("Connect your Gmail account before sending.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send 2 emails/ })).toBeDisabled();
  });

  it("explains when Gmail isn't set up at all", async () => {
    setup([item()], { connected: false, email: null, credentials_file_present: false });
    expect(await screen.findByText(/Gmail isn't set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Gmail" })).not.toBeInTheDocument();
  });

  it("shows a send error and lets you try again", async () => {
    apiError("post", "/api/campaigns", 422, "Everyone in this list has already been emailed.");
    const { onSent, user } = setup([item()]);
    await user.click(await screen.findByRole("button", { name: /Send 1 email/ }));
    expect(await screen.findByText("Everyone in this list has already been emailed.")).toBeInTheDocument();
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Send 1 email/ })).toBeEnabled();
  });

  it("warns when some emails will wait for the daily limit", async () => {
    const ready = [item(), item({ index: 1, to_email: "b@stripe.com" }), item({ index: 2, to_email: "c@stripe.com" })];
    api("post", "/api/campaigns/preview", preview(ready, {
      quota: quota({ daily_limit: 3, remaining: 1 }), sends_now: 1, sends_later: 2, later_from: "2026-10-06T15:00:00Z",
    }));
    render(<PreviewModal draft={DRAFT} attachments={[]} gmail={CONNECTED} onClose={() => {}} onSent={() => {}} />);
    expect(await screen.findByText(/Your daily limit is 3 emails/)).toHaveTextContent(
      `Your daily limit is 3 emails (1 left right now). 1 will send now; the other 2 will wait and go out automatically from about ${formatDateTime("2026-10-06T15:00:00Z")}.`,
    );
  });

  it("says when every email has to wait", async () => {
    api("post", "/api/campaigns/preview", preview([item()], {
      quota: quota({ remaining: 0, next_slot_at: "2026-10-06T18:00:00Z" }), sends_now: 0, sends_later: 1,
    }));
    render(<PreviewModal draft={DRAFT} attachments={[]} gmail={CONNECTED} onClose={() => {}} onSent={() => {}} />);
    expect(await screen.findByText(/Your daily limit is/)).toHaveTextContent(
      `(0 left right now). All 1 will wait and go out automatically from about ${formatDateTime("2026-10-06T18:00:00Z")}.`,
    );
  });

  it("doesn't mention the limit when everything sends now", async () => {
    setup([item()]);
    expect(await screen.findByText("Hi Jane")).toBeInTheDocument();
    expect(screen.queryByText(/Your daily limit is/)).not.toBeInTheDocument();
  });

  it("shows a preview error", async () => {
    apiError("post", "/api/campaigns/preview", 422, "Bad draft");
    render(<PreviewModal draft={DRAFT} attachments={[]} gmail={null} onClose={() => {}} onSent={() => {}} />);
    expect(await screen.findByText("Bad draft")).toBeInTheDocument();
  });

  it("goes back to editing", async () => {
    const { onClose, user } = setup([item()]);
    await user.click(screen.getByRole("button", { name: "Back to editing" }));
    expect(onClose).toHaveBeenCalled();
  });
});


describe("PreviewModal: scheduling", () => {
  beforeEach(() => {
    api("get", "/api/people-search/status", hunterStatus());
  });

  it("schedules the batch for a quick pick like tomorrow morning", async () => {
    const create = api("post", "/api/campaigns", campaign({ status: "scheduled" }), 201);
    const { onSent, user } = setup([item()]);
    await screen.findByRole("heading", { name: "Hi Jane" });
    await user.click(screen.getByRole("button", { name: /Schedule$/ }));
    expect(screen.getByText(/Times are in your timezone/)).toBeInTheDocument();

    const first = quickPicks()[0];
    await user.click(screen.getByRole("button", { name: first.label }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(create[0].body).toEqual({ ...DRAFT, scheduled_for: first.at.toISOString() });
  });

  it("schedules for a time you pick, but only in the future", async () => {
    const create = api("post", "/api/campaigns", campaign({ status: "scheduled" }), 201);
    const { onSent, user } = setup([item()]);
    await screen.findByRole("heading", { name: "Hi Jane" });
    await user.click(screen.getByRole("button", { name: /Schedule$/ }));
    const input = screen.getByLabelText("Pick a time");
    const confirm = screen.getByRole("button", { name: "Schedule 1 email" });

    fireEvent.change(input, { target: { value: "2020-01-01T09:00" } });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Pick a time in the future.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(confirm).toBeDisabled();
    expect(screen.queryByText("Pick a time in the future.")).not.toBeInTheDocument();

    const later = new Date(Date.now() + 3 * 86_400_000);
    later.setSeconds(0, 0);
    fireEvent.change(input, { target: { value: toLocalInput(later) } });
    await user.click(confirm);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(create[0].body).toEqual({ ...DRAFT, scheduled_for: later.toISOString() });
  });

  it("closes the schedule menu without scheduling", async () => {
    const { user } = setup([item()]);
    await screen.findByRole("heading", { name: "Hi Jane" });
    const toggle = screen.getByRole("button", { name: /Schedule$/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.queryByText(/Times are in your timezone/)).not.toBeInTheDocument();
  });
});

describe("PreviewModal: checking addresses exist", () => {
  const ok = (overrides: Partial<PreviewItem> = {}) => item(overrides);
  const verdict = (email: string, status: Verification["status"]): Verification => ({
    email, status, score: 90, checked_at: "2026-10-05T12:00:00Z", cached: true,
  });

  function open(status = hunterStatus({ verifications_total: 100, verifications_remaining: 94 })) {
    api("get", "/api/people-search/status", status);
    render(<PreviewModal draft={DRAFT} attachments={[]} gmail={CONNECTED} onClose={() => {}} onSent={() => {}} />);
    return userEvent.setup();
  }

  it("offers to verify unchecked addresses, then shows each verdict", async () => {
    const jane = ok();
    const gone = ok({ index: 1, to_email: "gone@stripe.com", values: { full_name: "Gone Person", email: "gone@stripe.com" } });
    let verified = false;
    api("post", "/api/campaigns/preview", () =>
      verified
        ? preview([
            { ...jane, verification: verdict("jane@stripe.com", "valid") },
            { ...gone, status: "undeliverable", verification: verdict("gone@stripe.com", "invalid") },
          ])
        : preview([jane, gone]),
    );
    const checks = api("post", "/api/people-search/verify", () => {
      verified = true;
      return { results: [verdict("jane@stripe.com", "valid"), verdict("gone@stripe.com", "invalid")] };
    });
    const user = open();

    expect(await screen.findByText(/Check 2 addresses exist before sending/)).toHaveTextContent(
      "Uses 2 of your 94 Hunter verifications left this month.",
    );
    await user.click(screen.getByRole("button", { name: "Verify 2" }));

    expect(await screen.findByText(/Addresses checked:/)).toHaveTextContent("Addresses checked: 1 verified · 1 doesn’t exist");
    expect(checks[0].body).toEqual({ emails: ["jane@stripe.com", "gone@stripe.com"] });
    expect(screen.getByText("verified")).toHaveAttribute("title", "Hunter confirmed this address exists.");
    expect(screen.getByText("doesn't exist", { selector: "span.inline-flex" })).toBeInTheDocument();
    expect(screen.getByText(/1 doesn't exist \(skipped\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Verify/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Gone Person/ }));
    expect(screen.getByText(/Hunter says this address doesn’t exist \(checked Oct 5\)/)).toBeInTheDocument();
  });

  it("explains risky verdicts but still sends them", async () => {
    api("post", "/api/campaigns/preview", preview([ok({ verification: verdict("jane@stripe.com", "accept_all") })]));
    open();
    expect(await screen.findByText(/Addresses checked:/)).toHaveTextContent("Addresses checked: 0 verified · 1 risky");
    expect(screen.getByText("risky")).toHaveAttribute("title", expect.stringContaining("accepts every address"));
    expect(screen.getByText(/accepts every address.*It’ll still be sent\./)).toBeInTheDocument();
  });

  it("says when Hunter is still checking some addresses", async () => {
    api("post", "/api/campaigns/preview", preview([ok()]));
    api("post", "/api/people-search/verify", { results: [{ email: "jane@stripe.com", status: "pending", score: null, checked_at: null, cached: false }] });
    const user = open();
    await user.click(await screen.findByRole("button", { name: "Verify 1" }));
    expect(await screen.findByText("Hunter is still checking 1 address. Try again in a minute.")).toBeInTheDocument();
  });

  it("shows why verifying failed", async () => {
    api("post", "/api/campaigns/preview", preview([ok()]));
    apiError("post", "/api/people-search/verify", 429, "You've used all your Hunter credits for this month.");
    const user = open();
    await user.click(await screen.findByRole("button", { name: "Verify 1" }));
    expect(await screen.findByText("You've used all your Hunter credits for this month.")).toBeInTheDocument();
  });

  it("without Hunter set up, there's nothing to verify with", async () => {
    api("post", "/api/campaigns/preview", preview([ok()]));
    open(hunterStatus({ configured: false }));
    expect(await screen.findByText("Hi Jane")).toBeInTheDocument();
    expect(screen.queryByText(/Check 1 address exist/)).not.toBeInTheDocument();
  });

  it("doesn't mention the allowance when Hunter doesn't report it", async () => {
    api("post", "/api/campaigns/preview", preview([ok()]));
    open(hunterStatus());
    expect(await screen.findByText(/Check 1 address exist before sending/)).not.toHaveTextContent("verifications left");
  });

  it("an unexpected verdict is treated as risky", () => {
    render(<VerificationBadge verification={{ ...verdict("a@x.com", "valid"), status: "weird" as Verification["status"] }} />);
    expect(screen.getByText("risky")).toBeInTheDocument();
  });
});
