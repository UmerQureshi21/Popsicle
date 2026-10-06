import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { hunterStatus, person, search } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import FindPeopleModal from "./FindPeopleModal";

const JANE = person();
const SAM = person({ email: "sam@stripe.com", full_name: "Sam Lee", already_emailed_at: "2026-03-01T12:00:00Z" });

function setup({ status = hunterStatus(), initialQuery = "stripe.com" } = {}) {
  api("get", "/api/people-search/status", status);
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<FindPeopleModal initialQuery={initialQuery} onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose, user: userEvent.setup() };
}

const searchButton = () => screen.getByRole("button", { name: "Search" });

describe("FindPeopleModal", () => {
  it("explains how to set up Hunter", async () => {
    setup({ status: hunterStatus({ configured: false }) });
    expect(await screen.findByText("Hunter isn’t set up yet.")).toBeInTheDocument();
  });

  it("shows Hunter's error and the credits left", async () => {
    setup({ status: hunterStatus({ error: "Hunter rejected the API key." }) });
    expect(await screen.findByText("Hunter rejected the API key.")).toBeInTheDocument();
    expect(screen.getByText(/Hunter credits left/)).toHaveTextContent("40 Hunter credits left · resets Nov 2");
  });

  it("searches with the filters and pre-selects people not emailed yet", async () => {
    const calls = api("post", "/api/people-search/company", search([JANE, SAM], { total: 2 }));
    const { user, onAdd, onClose } = setup();
    await user.type(screen.getByRole("textbox", { name: "Job title" }), " engineer ");
    await user.click(screen.getByRole("button", { name: "Department" }));
    await user.click(screen.getByRole("option", { name: "Engineering / IT" }));
    await user.click(screen.getByRole("button", { name: "Seniority" }));
    await user.click(screen.getByRole("option", { name: "Senior" }));
    await user.click(screen.getByRole("button", { name: "Location" }));
    await user.click(screen.getByRole("option", { name: "Anywhere" }));
    await user.click(screen.getByRole("button", { name: "How many people" }));
    await user.click(screen.getByRole("option", { name: /25 people/ }));
    await user.click(searchButton());

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(calls[0].body).toEqual({
      query: "stripe.com", limit: 25, offset: 0, department: "it", seniority: "senior", job_titles: "engineer", location: null, refresh: false,
    });
    expect(screen.getByText("showing 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const [all, jane, sam] = screen.getAllByRole("checkbox");
    expect([all, jane, sam].map((c) => (c as HTMLInputElement).checked)).toEqual([false, true, false]);

    await user.click(sam);
    expect(screen.getByText(/includes people you’ve already emailed/)).toBeInTheDocument();
    await user.click(jane);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(all);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(all);
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    await user.click(all);

    await user.click(screen.getByRole("button", { name: /Add 2 to recipients/ }));
    expect(onAdd).toHaveBeenCalledWith([JANE, SAM], "Stripe");
    expect(onClose).toHaveBeenCalled();
  });

  it("does nothing without a company", async () => {
    const calls = api("post", "/api/people-search/company", search([]));
    const { user } = setup({ initialQuery: "" });
    expect(searchButton()).toBeDisabled();
    await user.type(screen.getByRole("combobox", { name: "Company" }), "{Enter}");
    expect(calls).toHaveLength(0);
  });

  it("loads more people and can refresh saved results", async () => {
    let page = 0;
    const calls = api("post", "/api/people-search/company", ({ body }) => {
      page++;
      const b = body as { offset: number; refresh: boolean };
      if (b.refresh) return search([JANE], { total: 3, cached: false });
      return b.offset ? search([SAM, JANE], { total: 3, offset: 1, limit: 1 }) : search([JANE], { total: 3, limit: 1, cached: true });
    });
    const { user } = setup();
    await user.click(searchButton());
    await screen.findByText("Jane Doe");
    await user.click(screen.getByRole("button", { name: /Load 2 more/ }));
    expect(await screen.findByText("Sam Lee")).toBeInTheDocument();
    expect(calls[1].body).toMatchObject({ offset: 1 });
    expect(screen.getAllByText("Jane Doe")).toHaveLength(1); // not duplicated

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByText("saved results · refresh"));
    await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ refresh: true }));
    expect(page).toBe(4);
  });

  it("shows search errors", async () => {
    apiError("post", "/api/people-search/company", 429, "You've used all your Hunter credits for this month.");
    const { user } = setup();
    await user.click(searchButton());
    expect(await screen.findByText("You've used all your Hunter credits for this month.")).toBeInTheDocument();
  });

  it("when no one matches, offers looser searches", async () => {
    api("get", "/api/people-search/count", { total: 50, by_department: {}, by_seniority: {} });
    const calls = api("post", "/api/people-search/company", search([], { organization: null, domain: null }));
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Job title" }), "wizard");
    await user.click(screen.getByRole("button", { name: "Department" }));
    await user.click(screen.getByRole("option", { name: "Design" }));
    await user.click(screen.getByRole("button", { name: "Seniority" }));
    await user.click(screen.getByRole("option", { name: "Junior" }));
    await user.click(searchButton());
    expect(await screen.findByText(/none matching “wizard” in Design at junior level in the GTA/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Search anywhere/ }));
    await waitFor(() => expect(calls[1]?.body).toMatchObject({ location: null, job_titles: "wizard" }));
    expect(screen.getByRole("button", { name: "Location" })).toHaveTextContent("Anywhere");

    await user.click(await screen.findByRole("button", { name: /Remove the job title/ }));
    await waitFor(() => expect(calls[2]?.body).toMatchObject({ job_titles: null }));
    expect(screen.getByRole("textbox", { name: "Job title" })).toHaveValue("");
  });

  it("picking a suggestion searches it straight away", async () => {
    api("get", "/api/people-search/suggest", [{ name: "Harvey", domain: "harvey.ai", logo: null, email_count: 10 }]);
    const calls = api("post", "/api/people-search/company", search([JANE], { domain: "harvey.ai", organization: "Harvey" }));
    const { user } = setup({ initialQuery: "" });
    await user.type(screen.getByRole("combobox", { name: "Company" }), "harv");
    await user.click(await screen.findByRole("option", { name: /harvey\.ai/ }));
    await waitFor(() => expect(calls[0]?.body).toMatchObject({ query: "harvey.ai" }));
  });

  describe("looking up one person", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: /Look them up/ }));
    };

    it("finds and selects them", async () => {
      const found = person({ email: "new@stripe.com", full_name: "New Person" });
      const calls = api("post", "/api/people-search/person", { person: found, domain: "stripe.com", company: "Stripe", cached: false });
      const { user } = setup();
      await open(user);
      expect(screen.getByText(/At stripe\.com/)).toBeInTheDocument();
      await user.type(screen.getByPlaceholderText(/Full name/), " New Person ");
      await user.type(screen.getByPlaceholderText(/linkedin/), "linkedin.com/in/new{Enter}");
      expect(await screen.findByText("Found new@stripe.com")).toBeInTheDocument();
      expect(calls[0].body).toEqual({ company: "stripe.com", full_name: "New Person", linkedin_url: "linkedin.com/in/new" });
      expect(screen.getByText("1 selected")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Full name/)).toHaveValue("");

      await user.click(screen.getByRole("button", { name: /Look them up/ }));
      expect(screen.queryByPlaceholderText(/Full name/)).not.toBeInTheDocument();
    });

    it("uses the searched domain and says when no one was found", async () => {
      api("post", "/api/people-search/company", search([JANE], { domain: "stripe.com" }));
      const calls = api("post", "/api/people-search/person", { person: null, domain: null, company: null, cached: false });
      const { user } = setup({ initialQuery: "Stripe" });
      await user.click(searchButton());
      await screen.findByText("Jane Doe");
      await open(user);
      await user.type(screen.getByPlaceholderText(/Full name/), "Ghost");
      await user.click(screen.getByRole("button", { name: "Find email" }));
      expect(await screen.findByText("Hunter couldn’t find an email for them at stripe.com. No credit was used.")).toBeInTheDocument();
      expect(calls[0].body).toMatchObject({ company: "stripe.com", linkedin_url: null });
    });

    it("needs a name or URL and a company", async () => {
      const calls = api("post", "/api/people-search/person", {});
      const { user } = setup({ initialQuery: "" });
      await open(user);
      expect(screen.getByText(/At the company above/)).toBeInTheDocument();
      await user.type(screen.getByPlaceholderText(/Full name/), "Jane{Enter}");
      expect(calls).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Find email" })).toBeDisabled();
    });

    it("shows lookup errors", async () => {
      apiError("post", "/api/people-search/person", 422, "Give a full name or a LinkedIn profile URL.");
      const { user } = setup();
      await open(user);
      await user.type(screen.getByPlaceholderText(/linkedin/), "x{Enter}");
      expect(await screen.findByText("Give a full name or a LinkedIn profile URL.")).toBeInTheDocument();
    });
  });

  it("cancel closes", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
