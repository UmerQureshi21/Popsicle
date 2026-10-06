import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaign, email } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import CampaignProgress, { ProgressBar, isActive } from "./CampaignProgress";

const sending = () =>
  campaign({
    status: "sending",
    emails: [
      email({ id: 1, status: "sent", to_email: "a@x.com", sent_at: "2026-10-01T12:00:00Z" }),
      email({ id: 2, status: "pending", to_email: "b@x.com" }),
      email({ id: 3, status: "skipped", to_email: "c@x.com", error: "already emailed on Mar 01, 2026" }),
    ],
  });

describe("CampaignProgress", () => {
  afterEach(() => vi.useRealTimers());

  it("shows progress, each email and who's next", () => {
    render(<CampaignProgress initial={sending()} />);
    expect(screen.getByText("sending")).toBeInTheDocument();
    expect(screen.getByText(/of 2 sent/)).toHaveTextContent("1 of 2 sent · 1 skipped");
    expect(screen.getByText("next: b@x.com")).toBeInTheDocument();
    expect(screen.getByText("already emailed on Mar 01, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop sending/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume/ })).not.toBeInTheDocument();
  });

  it("polls while sending and stops once finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = campaign({ status: "completed", emails: [email({ status: "sent", to_email: "a@x.com" })] });
    const calls = api("get", "/api/campaigns/7", done);
    const onChange = vi.fn();
    render(<CampaignProgress initial={sending()} onChange={onChange} />);

    await act(() => vi.advanceTimersByTimeAsync(1600));
    await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith(done);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls).toHaveLength(1);
  });

  it("keeps polling through a failed request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = apiError("get", "/api/campaigns/7", 500);
    render(<CampaignProgress initial={sending()} />);
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("sending")).toBeInTheDocument();
  });

  it("stops sending", async () => {
    const cancelled = campaign({ status: "cancelled", emails: [email({ status: "cancelled" })] });
    const calls = api("post", "/api/campaigns/7/cancel", cancelled);
    const onChange = vi.fn();
    render(<CampaignProgress initial={sending()} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Stop sending/ }));
    expect(await screen.findByText("cancelled", { selector: "span.inline-flex" })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(onChange).toHaveBeenCalledWith(cancelled);
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });

  it("resumes an interrupted campaign and offers to reconnect Gmail", async () => {
    const interrupted = campaign({
      status: "interrupted",
      error: "Gmail didn't allow sending. Reconnect Gmail.",
      emails: [email({ status: "pending" })],
    });
    const calls = api("post", "/api/campaigns/7/resume", campaign({ status: "queued" }));
    render(<CampaignProgress initial={interrupted} />);
    expect(screen.getByRole("link", { name: "Connect Gmail" })).toHaveAttribute("href", "http://localhost:8000/api/gmail/connect");
    await userEvent.setup().click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("retries failed emails once finished", async () => {
    const finished = campaign({
      status: "completed",
      error: "Server restarted while sending.",
      emails: [email({ status: "failed", error: "bounced" }), email({ id: 2, status: "sent", sent_at: "2026-10-01T12:00:00Z" })],
    });
    const calls = api("post", "/api/campaigns/7/resume", campaign({ status: "queued" }));
    render(<CampaignProgress initial={finished} />);
    expect(screen.getByText(/· 1 failed/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Gmail" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry 1 failed" }));
    await waitFor(() => expect(calls[0]?.url.searchParams.get("retry_failed")).toBe("true"));
  });

  it("a cancelled campaign with nothing left to send can't be resumed", () => {
    render(<CampaignProgress initial={campaign({ status: "cancelled", emails: [email({ status: "sent" })] })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

it("isActive", () => {
  expect(isActive({ status: "queued" })).toBe(true);
  expect(isActive({ status: "sending" })).toBe(true);
  expect(isActive({ status: "completed" })).toBe(false);
});

it("ProgressBar with nothing to send", () => {
  const { container } = render(<ProgressBar sent={0} failed={0} total={0} />);
  const [sent, failed] = Array.from((container.firstChild as HTMLElement).children) as HTMLElement[];
  expect([sent.style.width, failed.style.width]).toEqual(["0%", "0%"]);
});
