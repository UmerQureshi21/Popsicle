import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Company, Contact } from "@/lib/api";
import { navigation } from "@/test/navigation";
import { api, apiError } from "@/test/server";
import CompaniesPage from "./page";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const company = (overrides: Partial<Company> = {}): Company => ({
  id: 1, name: "Stripe", domain: "stripe.com", linkedin_url: null, notes: null, status: "emailed", created_at: "2026-09-01T12:00:00Z",
  contact_count: 2, emailed_count: 1, last_sent_at: "2026-10-01T12:00:00Z", ...overrides,
});

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 1, email: "jane@stripe.com", full_name: "Jane Doe", first_name: "Jane", last_name: "Doe", title: "Engineer",
  linkedin_url: "https://linkedin.com/in/jane", notes: null, company_id: 1, company_name: "Stripe",
  created_at: "2026-09-01T12:00:00Z", sent_count: 2, last_sent_at: "2026-10-01T12:00:00Z", last_status: "sent", ...overrides,
});

const LIST = [
  company({ linkedin_url: "https://linkedin.com/company/stripe" }),
  company({ id: 2, name: "Shopify", domain: "shopify.com", status: "not_started", emailed_count: 0, contact_count: 0, last_sent_at: null }),
  company({ id: 3, name: "Acme", domain: null, status: "replied" }),
];

describe("Companies page", () => {
  it("shows each company with its logo, status and counts", async () => {
    api("get", "/api/companies", LIST);
    render(<CompaniesPage />);
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("no domain yet")).toBeInTheDocument();
    const logos = document.querySelectorAll("img");
    expect([...logos].map((i) => decodeURIComponent(i.getAttribute("src") ?? ""))).toEqual([
      expect.stringContaining("logos.hunter.io/stripe.com"),
      expect.stringContaining("logos.hunter.io/shopify.com"),
    ]);
    expect(screen.getByRole("button", { name: "Status of Stripe" })).toHaveTextContent("Emailed");
    expect(screen.getByRole("button", { name: "Status of Acme" })).toHaveTextContent("Replied");
    expect(screen.getAllByText(/emailed$/)[0].closest("span")).toHaveTextContent("1/2 emailed");
  });

  it("filters by status, with counts", async () => {
    api("get", "/api/companies", LIST);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await screen.findByText("Stripe");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["All 3", "Not started 1", "Emailed 1", "Replied 1", "Not a fit 0"]);

    await user.click(screen.getByRole("tab", { name: /Not started/ }));
    expect(screen.getByRole("tab", { name: /Not started/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Shopify")).toBeInTheDocument();
    expect(screen.queryByText("Stripe")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Not a fit/ }));
    expect(screen.getByText("No companies are not a fit.")).toBeInTheDocument();
  });

  it("changes a company's status", async () => {
    api("get", "/api/companies", LIST);
    const patch = api("patch", "/api/companies/2", company({ id: 2, status: "replied" }));
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Status of Shopify" }));
    await user.click(screen.getByRole("option", { name: "Replied" }));
    expect(screen.getByRole("button", { name: "Status of Shopify" })).toHaveTextContent("Replied");
    expect(screen.getByRole("tab", { name: /Replied/ })).toHaveTextContent("Replied 2");
    await waitFor(() => expect(patch[0]?.body).toEqual({ status: "replied" }));
  });

  it("puts the status back if saving it fails", async () => {
    api("get", "/api/companies", LIST);
    apiError("patch", "/api/companies/2", 500, "Database is down");
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Status of Shopify" }));
    await user.click(screen.getByRole("option", { name: "Not a fit" }));
    expect(await screen.findByText("Database is down")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Status of Shopify" })).toHaveTextContent("Not started"));
  });

  it("sends the selected companies to Find people", async () => {
    localStorage.setItem("popsicle:find-people:v1", JSON.stringify({ jobTitle: "designer", chips: [{ query: "old.com" }], results: [{ query: "old.com" }] }));
    api("get", "/api/companies", LIST);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Select Shopify" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Find people at Shopify/ })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Acme" }));

    await user.click(screen.getByRole("button", { name: /Find people at 2 companies/ }));
    expect(navigation.router.push).toHaveBeenCalledWith("/find");
    expect(JSON.parse(localStorage.getItem("popsicle:find-people:v1")!)).toEqual({
      jobTitle: "designer",
      chips: [
        { query: "shopify.com", label: "Shopify", domain: "shopify.com" },
        { query: "Acme", label: "Acme", domain: null },
      ],
      results: [],
    });
  });

  it("starts a fresh Find people search when nothing was saved", async () => {
    api("get", "/api/companies", LIST);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Select Stripe" }));
    await user.click(screen.getByRole("button", { name: /Find people at Stripe/ }));
    expect(JSON.parse(localStorage.getItem("popsicle:find-people:v1")!).chips).toEqual([{ query: "stripe.com", label: "Stripe", domain: "stripe.com" }]);
  });

  it("unselects, clears the selection, and only counts companies in view", async () => {
    api("get", "/api/companies", LIST);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    const stripe = await screen.findByRole("checkbox", { name: "Select Stripe" });
    await user.click(stripe);
    await user.click(screen.getByRole("checkbox", { name: "Select Shopify" }));
    await user.click(stripe);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Replied/ }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /All/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("fills in missing domains so logos show", async () => {
    let list = LIST;
    api("get", "/api/companies", () => list);
    const fill = api("post", "/api/companies/fill-domains", () => {
      list = LIST.map((c) => (c.id === 3 ? { ...c, domain: "acme.com" } : c));
      return { filled: 1, missing: 0 };
    });
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Find 1 missing logo" }));
    expect(await screen.findByText("Found 1 domain.")).toBeInTheDocument();
    expect(fill).toHaveLength(1);
    expect(await screen.findByText("acme.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /missing logo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Found 1 domain.")).not.toBeInTheDocument();
  });

  it("says when Hunter only knew some, or none, of the missing domains", async () => {
    const two = [company({ id: 3, name: "Acme", domain: null }), company({ id: 4, name: "Zed", domain: null }), company({ id: 5, name: "Qux", domain: null })];
    api("get", "/api/companies", two);
    let answer = { filled: 2, missing: 1 };
    api("post", "/api/companies/fill-domains", () => answer);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Find 3 missing logos" }));
    expect(await screen.findByText("Found 2 domains. Hunter didn’t know 1; add those by hand.")).toBeInTheDocument();
    answer = { filled: 0, missing: 3 };
    await user.click(screen.getByRole("button", { name: "Find 3 missing logos" }));
    expect(await screen.findByText("Hunter didn’t recognise any of those names. Add their domains by hand.")).toBeInTheDocument();
  });

  it("shows why filling domains failed, and Looking up… meanwhile", async () => {
    api("get", "/api/companies", [company({ domain: null })]);
    let fail: (r: Response) => void = () => {};
    api("post", "/api/companies/fill-domains", () => new Promise<Response>((r) => (fail = r)));
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Find 1 missing logo" }));
    expect(screen.getByRole("button", { name: "Looking up…" })).toBeDisabled();
    fail(Response.json({ detail: "Hunter isn't set up." }, { status: 400 }));
    expect(await screen.findByText("Hunter isn't set up.")).toBeInTheDocument();
  });

  it("shows one company's contacts", async () => {
    api("get", "/api/companies", LIST);
    const contacts = api("get", "/api/contacts", [contact(), contact({ id: 2, email: "sam@stripe.com", full_name: null, title: null, last_status: null, last_sent_at: null })]);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Stripe/ }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("Jane Doe")).toBeInTheDocument();
    expect(within(dialog).getByText("not emailed")).toBeInTheDocument();
    expect(within(dialog).getByText(/Added Sep/)).toBeInTheDocument();
    expect(contacts[0].url.searchParams.get("company_id")).toBe("1");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a company with no contacts, and Loading… first", async () => {
    api("get", "/api/companies", [company()]);
    let answer: (r: Response) => void = () => {};
    api("get", "/api/contacts", () => new Promise<Response>((r) => (answer = r)));
    render(<CompaniesPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /^Stripe/ }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    answer(Response.json([]));
    expect(await screen.findByText("No contacts at this company yet.")).toBeInTheDocument();
  });

  it("deletes a company after confirming", async () => {
    let list = [company()];
    api("get", "/api/companies", () => list);
    api("get", "/api/contacts", []);
    const del = api("delete", "/api/companies/1", () => {
      list = [];
      return new Response(null, { status: 204 });
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Select Stripe" }));
    await user.click(screen.getByRole("button", { name: /^Stripe/ }));
    await user.click(screen.getByRole("button", { name: /Delete company/ }));
    expect(del).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /Delete company/ }));
    expect(await screen.findByText("No companies yet")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith("Delete Stripe? Its contacts and sent history are kept.");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("shows a load error", async () => {
    apiError("get", "/api/companies", 500, "Database is down");
    render(<CompaniesPage />);
    expect(await screen.findByText("Database is down")).toBeInTheDocument();
  });
});

describe("Companies page: adding", () => {
  const SUGGESTIONS = [{ name: "Wealthsimple", domain: "wealthsimple.com", logo: null, email_count: 120 }];

  it("adds companies picked, typed and pasted as a list", async () => {
    let list: Company[] = [];
    api("get", "/api/companies", () => list);
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const bulk = api("post", "/api/companies/bulk", () => {
      list = [company({ id: 9, name: "Wealthsimple", domain: "wealthsimple.com", status: "not_started" })];
      return { added: list, skipped: ["Stripe", "Shopify"] };
    });
    render(<CompaniesPage />);
    const user = userEvent.setup();
    expect(await screen.findByText("No companies yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add companies/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();

    const input = within(dialog).getByRole("combobox", { name: "Company name or domain" });
    await user.type(input, "Wealth");
    await user.click(await screen.findByRole("option", { name: /wealthsimple\.com/ }));
    await user.click(input);
    await user.paste("Stripe\nShopify, stripe");
    await user.type(input, "Harvey{Enter}");
    await user.type(input, "Cohere");
    expect(within(dialog).getAllByRole("button", { name: /^Remove/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove Wealthsimple", "Remove Stripe", "Remove Shopify", "Remove Harvey",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Remove Harvey" }));
    await user.click(within(dialog).getByRole("button", { name: "Add 4" }));

    expect(await screen.findByText("Added 1 company; Stripe, Shopify were already on your list.")).toBeInTheDocument();
    expect(bulk[0].body).toEqual({ lines: ["wealthsimple.com", "Stripe", "Shopify", "Cohere"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Wealthsimple")).toBeInTheDocument();
  });

  it("removes the last chip with backspace, ignores a one-name paste, and cancels", async () => {
    api("get", "/api/companies", []);
    api("get", "/api/people-search/suggest", []);
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Add companies/ }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("combobox", { name: "Company name or domain" });
    await user.type(input, "acme.io{Enter}");
    expect(within(dialog).getByText("acme.io")).toBeInTheDocument();
    await user.type(input, "{Backspace}");
    expect(within(dialog).queryByText("acme.io")).not.toBeInTheDocument();
    await user.click(input);
    await user.paste("Solo");
    expect(input).toHaveValue("Solo");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add companies/ }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Company name or domain" })).toHaveValue("");
  });

  it("says when one company was added and one skipped, and shows errors", async () => {
    api("get", "/api/companies", []);
    api("get", "/api/people-search/suggest", []);
    let fail = true;
    api("post", "/api/companies/bulk", () =>
      fail ? Response.json({ detail: "Database is down" }, { status: 500 }) : { added: [company({ name: "Acme" })], skipped: ["Stripe"] },
    );
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Add companies/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("combobox", { name: "Company name or domain" }), "Acme");
    await user.click(within(dialog).getByRole("button", { name: "Add 1" }));
    expect(await within(dialog).findByText("Database is down")).toBeInTheDocument();
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Add 1" }));
    expect(await screen.findByText("Added 1 company; Stripe was already on your list.")).toBeInTheDocument();
  });

  it("just says how many were added when none were skipped", async () => {
    api("get", "/api/companies", []);
    api("get", "/api/people-search/suggest", []);
    api("post", "/api/companies/bulk", { added: [company({ name: "Acme" }), company({ id: 2, name: "Zed" })], skipped: [] });
    render(<CompaniesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Add companies/ }));
    const input = within(screen.getByRole("dialog")).getByRole("combobox", { name: "Company name or domain" });
    await user.click(input);
    await user.paste("Acme, Zed");
    await user.click(screen.getByRole("button", { name: "Add 2" }));
    expect(await screen.findByText("Added 2 companies.")).toBeInTheDocument();
  });
});
