import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { readHandoff } from "@/lib/people";
import { hunterStatus, person, search } from "@/test/fixtures";
import { navigation } from "@/test/navigation";
import { api, apiError } from "@/test/server";
import FindPeople from "./FindPeople";

const STORAGE_KEY = "popsicle:find-people:v1";
const JANE = person();
const SAM = person({ email: "sam@stripe.com", full_name: "Sam Lee", already_emailed_at: "2026-03-01T12:00:00Z" });

function setup({ status = hunterStatus(), saved }: { status?: ReturnType<typeof hunterStatus>; saved?: object } = {}) {
  if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  api("get", "/api/people-search/status", status);
  render(<FindPeople />);
  return userEvent.setup();
}

const companyBox = () => screen.getByRole("combobox", { name: "Add a company" });
const searchButton = () => screen.getByRole("button", { name: /^Search/ });
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!);
const paste = (text: string) => fireEvent.paste(companyBox(), { clipboardData: { getData: () => text } });

describe("FindPeople", () => {
  it("explains how to set up Hunter", async () => {
    setup({ status: hunterStatus({ configured: false }) });
    expect(await screen.findByText("Hunter isn’t set up yet")).toBeInTheDocument();
  });

  it("starts with the default filters and shows the credits left", async () => {
    setup();
    expect(screen.getByRole("textbox", { name: /Job title/ })).toHaveValue("software engineer");
    expect(screen.getByRole("button", { name: "Location" })).toHaveTextContent("Greater Toronto Area");
    expect(await screen.findByText(/credits left/)).toHaveTextContent("40 of 50 credits left (resets Nov 2) ·");
    expect(screen.getByText(/1 credit per 10 people found ·/)).toBeInTheDocument();
    expect(searchButton()).toBeDisabled();
  });

  it("credits without a total or reset date", async () => {
    setup({ status: hunterStatus({ credits_total: null, reset_date: null }) });
    expect(await screen.findByText(/credits left/)).toHaveTextContent(/^40 credits left ·/);
  });

  it("adds companies as chips: typed, pasted or picked, without duplicates", async () => {
    api("get", "/api/people-search/suggest", [{ name: "Harvey", domain: "harvey.ai", logo: null, email_count: 10 }]);
    const user = setup();
    await user.type(companyBox(), "https://www.Stripe.com/jobs{Enter}");
    paste("Shopify, stripe.com\nHarvey AI");
    paste("single"); // no separators: left to the normal paste
    await user.type(companyBox(), "harv");
    await user.click(await screen.findByRole("option", { name: /harvey\.ai/ }));

    expect(saved().chips.map((c: { label: string }) => c.label)).toEqual(["stripe.com", "Shopify", "Harvey AI", "Harvey"]);
    expect(screen.getByText("harvey.ai")).toBeInTheDocument(); // the picked chip shows its domain
    expect(searchButton()).toHaveTextContent("Search 4 companies");
    expect(screen.getByText(/uses up to 4 credits/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Shopify" }));
    await user.click(companyBox());
    await user.keyboard("{Backspace}");
    expect(saved().chips.map((c: { label: string }) => c.label)).toEqual(["stripe.com", "Harvey AI"]);
  });

  it("searches each company in turn and hands the picked people to Compose", async () => {
    const calls = api("post", "/api/people-search/company", ({ body }) => {
      const q = (body as { query: string }).query;
      return q === "stripe.com" ? search([JANE, SAM]) : search([], { domain: "tiny.io", organization: null, total: 0 });
    });
    api("get", "/api/people-search/count", { total: 0, by_department: {}, by_seniority: {} });
    const user = setup({ saved: { chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }, { query: "tiny.io", label: "tiny.io", domain: "tiny.io" }] } });
    const status = api("get", "/api/people-search/status", hunterStatus());

    await user.click(screen.getByRole("button", { name: "Location" }));
    await user.click(screen.getByRole("option", { name: "Anywhere in Canada" }));
    await user.click(screen.getByRole("button", { name: "People per company" }));
    await user.click(screen.getByRole("option", { name: /Up to 25/ }));
    await user.click(searchButton());

    const stripe = (await screen.findByText("Jane Doe")).closest("section")!;
    expect(within(stripe).getByText(/2 of 2 matching “software engineer” in Canada/)).toBeInTheDocument();
    expect(calls.map((c) => c.body)).toEqual([
      { query: "stripe.com", limit: 25, offset: 0, job_titles: "software engineer", location: [{ country: "CA" }], refresh: false },
      { query: "tiny.io", limit: 25, offset: 0, job_titles: "software engineer", location: [{ country: "CA" }], refresh: false },
    ]);
    expect(await screen.findByText(/Hunter has no people for tiny\.io yet/)).toBeInTheDocument();
    await waitFor(() => expect(status).toHaveLength(2)); // credits refreshed after each search

    // Sam was already emailed, so only Jane starts ticked.
    const [all, jane, sam] = within(stripe).getAllByRole("checkbox");
    expect([all, jane, sam].map((c) => (c as HTMLInputElement).checked)).toEqual([false, true, false]);
    await user.click(sam);
    await user.click(jane);
    await user.click(all);
    await user.click(all);
    await user.click(all);
    await user.click(within(stripe).getByRole("button", { name: /Email 2 people/ }));
    expect(readHandoff()).toEqual({ company: "Stripe", people: [JANE, SAM] });
    expect(navigation.router.push).toHaveBeenCalledWith("/compose");
  });

  it("one person selected says person", async () => {
    api("post", "/api/people-search/company", search([JANE]));
    const user = setup({ saved: { chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }] } });
    await user.click(searchButton());
    expect(await screen.findByRole("button", { name: /Email 1 person/ })).toBeEnabled();
  });

  it("loads more and refreshes saved results", async () => {
    const calls = api("post", "/api/people-search/company", ({ body }) => {
      const b = body as { offset: number; refresh: boolean };
      if (b.offset) return search([SAM, JANE], { total: 3, offset: 1, limit: 1, cached: true });
      return search([JANE], { total: 3, limit: 1, cached: !b.refresh });
    });
    const user = setup({ saved: { chips: [{ query: "Stripe", label: "Stripe", domain: null }], jobTitle: "" } });
    await user.click(searchButton());
    await user.click(await screen.findByRole("button", { name: /Load more/ }));
    expect(await screen.findByText("Sam Lee")).toBeInTheDocument();
    expect(calls[1].body).toMatchObject({ offset: 1, job_titles: null });
    expect(screen.getByText(/2 of 3 in the GTA/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "saved results · refresh" }));
    await waitFor(() => expect(calls[2]?.body).toMatchObject({ refresh: true, offset: 0 }));
    expect(await screen.findByText(/1 of 3/)).toBeInTheDocument();
  });

  it("offers looser searches when no one matched", async () => {
    api("get", "/api/people-search/count", { total: 80, by_department: { it: 30 }, by_seniority: {} });
    const calls = api("post", "/api/people-search/company", search([], { total: 0 }));
    const user = setup({ saved: { chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }] } });
    await user.click(searchButton());
    await user.click(await screen.findByRole("button", { name: /Search anywhere/ }));
    await waitFor(() => expect(calls[1]?.body).toMatchObject({ location: null, job_titles: "software engineer" }));
    await user.click(await screen.findByRole("button", { name: /Remove the job title/ }));
    await waitFor(() => expect(calls[2]?.body).toMatchObject({ location: null, job_titles: null }));
    // With both filters gone there's nothing left to loosen.
    await screen.findByText(/but none for this search/);
    expect(screen.queryByRole("button", { name: /Search anywhere|Remove the job title/ })).not.toBeInTheDocument();
  });

  it("shows a failed search", async () => {
    apiError("post", "/api/people-search/company", 429, "You've used all your Hunter credits for this month.");
    const user = setup({ saved: { chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }] } });
    await user.click(searchButton());
    expect(await screen.findByText("You've used all your Hunter credits for this month.")).toBeInTheDocument();
  });

  it("shows Searching… while a company loads", async () => {
    api("post", "/api/people-search/company", () => new Promise(() => {}));
    const user = setup({ saved: { chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }] } });
    await user.click(searchButton());
    expect(screen.getByText("Searching Hunter…")).toBeInTheDocument();
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("restores saved searches, marking interrupted ones as failed", () => {
    setup({
      saved: {
        chips: [{ query: "stripe.com", label: "stripe.com", domain: "stripe.com" }],
        results: [
          { query: "stripe.com", state: "loading", people: [], selected: [] },
          { query: "done.io", state: "done", people: [JANE], selected: [], search: search([JANE], { domain: "done.io", organization: "Done" }) },
        ],
      },
    });
    expect(screen.getByText("Interrupted. Search again.")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Email 0 people/ })).toBeDisabled();
  });

  it("reads companies saved by older versions as text", () => {
    setup({ saved: { companiesText: "Stripe\nharvey.ai" } });
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("harvey.ai")).toBeInTheDocument();
  });

  it("ignores corrupted saved data", () => {
    localStorage.setItem(STORAGE_KEY, "{bad");
    setup();
    expect(screen.getByRole("textbox", { name: /Job title/ })).toHaveValue("software engineer");
  });
});
