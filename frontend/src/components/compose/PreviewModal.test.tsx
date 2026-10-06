import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CampaignDraft, GmailStatus, Preview, PreviewItem } from "@/lib/api";
import { campaign } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import PreviewModal from "./PreviewModal";

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

const preview = (items: PreviewItem[]): Preview => ({
  items,
  ready: items.filter((i) => i.status === "ready").length,
  already_sent: items.filter((i) => i.status === "already_sent").length,
  invalid: items.filter((i) => i.status === "invalid").length,
});

function setup(items: PreviewItem[], gmail: GmailStatus | null = CONNECTED, attachments = [] as React.ComponentProps<typeof PreviewModal>["attachments"]) {
  const calls = api("post", "/api/campaigns/preview", preview(items));
  const onSent = vi.fn();
  const onClose = vi.fn();
  render(<PreviewModal draft={DRAFT} attachments={attachments} gmail={gmail} onClose={onClose} onSent={onSent} />);
  return { calls, onSent, onClose, user: userEvent.setup() };
}

describe("PreviewModal", () => {
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
