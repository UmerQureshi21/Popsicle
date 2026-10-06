import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/format";
import { quota } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import SendingSafety from "./SendingSafety";

describe("SendingSafety", () => {
  it("shows how much of the daily limit is used", async () => {
    api("get", "/api/sending/quota", quota());
    render(<SendingSafety />);
    expect(await screen.findByText("6 of 40 sent in the last 24 hours")).toBeInTheDocument();
    expect(screen.getByText("34 more can go out today · at least 20s between emails")).toBeInTheDocument();
  });

  it("warns when the limit is reached and says when there's room again", async () => {
    api("get", "/api/sending/quota", quota({ sent_last_24h: 40, remaining: 0, next_slot_at: "2026-10-06T15:30:00Z" }));
    render(<SendingSafety />);
    const msg = await screen.findByText(/Daily limit reached/);
    expect(msg).toHaveTextContent(`More room at ${formatDateTime("2026-10-06T15:30:00Z")}; waiting batches carry on by themselves.`);
    expect(msg.className).toContain("text-crimson");
  });

  it("edits and saves the limits", async () => {
    api("get", "/api/sending/quota", quota());
    const saves = api("put", "/api/sending/settings", quota({ daily_limit: 25, min_delay_seconds: 45, remaining: 19 }));
    render(<SendingSafety />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit limits" }));

    const limit = screen.getByRole("spinbutton", { name: "Emails per 24 hours" });
    const gap = screen.getByRole("spinbutton", { name: "Seconds between emails (at least)" });
    expect(limit).toHaveValue(40);
    expect(gap).toHaveValue(20);
    expect(screen.getByText(/30–50 a day is a safe range/)).toBeInTheDocument();
    await user.clear(limit);
    await user.type(limit, "25");
    await user.clear(gap);
    await user.type(gap, "45");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("6 of 25 sent in the last 24 hours")).toBeInTheDocument();
    expect(saves[0].body).toEqual({ daily_limit: 25, min_delay_seconds: 45 });
    expect(screen.queryByRole("spinbutton", { name: "Emails per 24 hours" })).not.toBeInTheDocument();
  });

  it("shows why saving failed, and editing can be cancelled", async () => {
    api("get", "/api/sending/quota", quota());
    apiError("put", "/api/sending/settings", 422, "Input should be less than or equal to 500");
    render(<SendingSafety />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit limits" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Input should be less than or equal to 500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("refetches when asked to refresh", async () => {
    const calls = api("get", "/api/sending/quota", quota());
    const { rerender } = render(<SendingSafety refreshKey={1} />);
    await screen.findByText(/sent in the last 24 hours/);
    rerender(<SendingSafety refreshKey={2} />);
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("shows nothing if the limits can't be loaded", async () => {
    const calls = apiError("get", "/api/sending/quota", 500);
    const { container } = render(<SendingSafety />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
