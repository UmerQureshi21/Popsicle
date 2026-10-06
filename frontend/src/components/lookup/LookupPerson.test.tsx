import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailFinderResult } from "@/lib/api";
import { readHandoff } from "@/lib/people";
import { hunterStatus, person } from "@/test/fixtures";
import { navigation } from "@/test/navigation";
import { api, apiError } from "@/test/server";
import LookupPerson from "./LookupPerson";

const STORAGE_KEY = "popsicle:lookups:v1";

function setup({ status = hunterStatus(), saved }: { status?: ReturnType<typeof hunterStatus>; saved?: unknown } = {}) {
  if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  api("get", "/api/people-search/status", status);
  render(<LookupPerson />);
  return userEvent.setup();
}

const nameBox = () => screen.getByPlaceholderText("e.g. Jane Doe");
const linkedinBox = () => screen.getByPlaceholderText("linkedin.com/in/jane-doe");
const companyBox = () => screen.getByRole("combobox", { name: "Company" });
const findButton = () => screen.getByRole("button", { name: "Find email" });

const found = (overrides = {}): EmailFinderResult => ({
  person: person({ email: "jane@harvey.ai", linkedin_url: "https://linkedin.com/in/jane", ...overrides }),
  domain: "harvey.ai",
  company: "Harvey",
  cached: false,
});

describe("LookupPerson", () => {
  afterEach(() => vi.useRealTimers());

  it("explains how to set up Hunter", async () => {
    setup({ status: hunterStatus({ configured: false }) });
    expect(await screen.findByText("Hunter isn’t set up yet")).toBeInTheDocument();
  });

  it("needs a name and company, or just a LinkedIn profile", async () => {
    const user = setup();
    expect(await screen.findByText(/40/)).toBeInTheDocument();
    expect(findButton()).toBeDisabled();
    await user.type(nameBox(), "Jane Doe");
    expect(findButton()).toBeDisabled();
    await user.type(companyBox(), "harvey.ai");
    expect(findButton()).toBeEnabled();
    await user.clear(nameBox());
    await user.clear(companyBox());
    await user.type(linkedinBox(), "https://www.linkedin.com/in/jane");
    expect(findButton()).toBeEnabled();
    expect(screen.getByText("optional with a LinkedIn profile")).toBeInTheDocument();
  });

  it("finds an email and shows what Hunter knows", async () => {
    const calls = api("post", "/api/people-search/person", found({ already_emailed_at: "2026-03-01T12:00:00Z", confidence: 98 }));
    const user = setup();
    const credits = api("get", "/api/people-search/status", hunterStatus());
    await user.type(nameBox(), " Jane Doe ");
    await user.type(companyBox(), "harvey.ai{Enter}");

    expect(await screen.findByText("jane@harvey.ai")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ company: "harvey.ai", full_name: "Jane Doe", linkedin_url: null });
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText(/already emailed Mar/)).toBeInTheDocument();
    expect(screen.getByText(/Software Engineer · Harvey · just now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn profile" })).toHaveAttribute("href", "https://linkedin.com/in/jane");
    expect(nameBox()).toHaveValue(""); // cleared for the next lookup
    await waitFor(() => expect(credits).toHaveLength(1)); // credits refreshed after the lookup

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored[0]).toMatchObject({ name: "Jane Doe", company: "harvey.ai", result: { company: "Harvey" } });
  });

  it.each([
    ["accept_all", "Company accepts all emails"],
    ["unknown", "Not verified"],
  ])("shows %s verification", async (status, label) => {
    api("post", "/api/people-search/person", found({ verification_status: status }));
    const user = setup();
    await user.type(linkedinBox(), "linkedin.com/in/jane{Enter}");
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("copies the email", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api("post", "/api/people-search/person", found({ verification_status: null }));
    const user = setup();
    await user.type(linkedinBox(), "linkedin.com/in/jane{Enter}");
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("jane@harvey.ai");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it.each([
    ["Email them", "replace"],
    ["Add to batch", "append"],
  ])("%s sends them to Compose", async (button, mode) => {
    const user = setup({
      saved: [{ id: "1", name: "Jane", linkedin: "", company: "harvey.ai", at: "2026-10-01T12:00:00Z", result: found() }],
    });
    await user.click(screen.getByRole("button", { name: new RegExp(button) }));
    expect(readHandoff()).toEqual({ company: "Harvey", people: [found().person], mode });
    expect(navigation.router.push).toHaveBeenCalledWith("/compose");
  });

  it("uses the domain or typed company when Hunter doesn't name the company", async () => {
    const user = setup({
      saved: [
        { id: "1", name: "A", linkedin: "", company: "typed.io", at: "2026-10-01T12:00:00Z", result: { ...found(), company: null, domain: null } },
        { id: "2", name: "B", linkedin: "", company: "", at: "2026-10-01T12:00:00Z", result: { ...found(), company: null, domain: null } },
      ],
    });
    const [first, second] = screen.getAllByRole("button", { name: /Email them/ });
    await user.click(first);
    expect(readHandoff()?.company).toBe("typed.io");
    await user.click(second);
    expect(readHandoff()?.company).toBeNull();
  });

  it("says when no email was found, and keeps the name typed", async () => {
    api("post", "/api/people-search/person", { person: null, domain: "harvey.ai", company: null, cached: false });
    const user = setup();
    await user.type(nameBox(), "Ghost");
    await user.type(companyBox(), "Harvey{Enter}");
    expect(await screen.findByText(/Hunter couldn’t find an email for them at harvey\.ai/)).toBeInTheDocument();
    expect(nameBox()).toHaveValue("Ghost");
    expect(screen.getByText("Ghost")).toBeInTheDocument();
  });

  it("says when a LinkedIn profile gave nothing", () => {
    setup({
      saved: [{ id: "1", name: "", linkedin: "linkedin.com/in/x", company: "", at: "2026-10-01T12:00:00Z", result: { person: null, domain: null, company: null, cached: false } }],
    });
    expect(screen.getByText(/from that LinkedIn profile/)).toBeInTheDocument();
    expect(screen.getByText("linkedin.com/in/x")).toBeInTheDocument();
  });

  it("shows errors", async () => {
    apiError("post", "/api/people-search/person", 422, "That doesn't look like a LinkedIn profile URL (linkedin.com/in/…).");
    const user = setup();
    await user.type(linkedinBox(), "linkedin.com/in/x{Enter}");
    expect(await screen.findByText(/doesn't look like a LinkedIn profile/)).toBeInTheDocument();
  });

  it("removes one recent lookup or clears them all", async () => {
    const entry = (id: string, name: string) => ({ id, name, linkedin: "", company: "", at: "2026-10-01T12:00:00Z", result: { person: null, domain: null, company: null, cached: false } });
    const user = setup({ saved: [entry("1", "First"), entry("2", "Second")] });
    await user.click(screen.getAllByRole("button", { name: "Remove from recent lookups" })[0]);
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Recent lookups")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });

  it("ignores corrupted saved lookups and storage errors", async () => {
    localStorage.setItem(STORAGE_KEY, "{bad");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    setup();
    expect(screen.queryByText("Recent lookups")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
