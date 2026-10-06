import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CompanySuggestion } from "@/lib/api";
import { api, apiError } from "@/test/server";
import CompanyAutocomplete, { CompanyLogo } from "./CompanyAutocomplete";

const SUGGESTIONS: CompanySuggestion[] = [
  { name: "Harvey", domain: "harvey.net", logo: null, email_count: 3 },
  { name: "Harvey AI", domain: "harvey.ai", logo: null, email_count: 1200 },
  { name: null, domain: "harvey.io", logo: null, email_count: 1 },
  { name: "No count", domain: "harvey.org", logo: null, email_count: null },
];

function Harness(props: { onPick?: (s: CompanySuggestion) => void; onSubmitRaw?: (t: string) => void; onBackspaceEmpty?: () => void }) {
  const [value, setValue] = useState("");
  return <CompanyAutocomplete ariaLabel="Company" value={value} onChange={setValue} onPick={props.onPick ?? (() => {})} {...props} />;
}

const input = () => screen.getByRole("combobox", { name: "Company" });

describe("CompanyAutocomplete", () => {
  it("suggests companies as you type, biggest first", async () => {
    const calls = api("get", "/api/people-search/suggest", SUGGESTIONS);
    render(<Harness />);
    await userEvent.setup().type(input(), "harv");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Harvey AIharvey.ai1,200 people",
      "Harveyharvey.net3 people",
      "harvey.ioharvey.io1 person",
      "No countharvey.org",
    ]);
    expect(calls.at(-1)!.url.searchParams.get("q")).toBe("harv");
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("doesn't ask for one-letter queries", async () => {
    const calls = api("get", "/api/people-search/suggest", SUGGESTIONS);
    render(<Harness />);
    await userEvent.setup().type(input(), "h");
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(0);
  });

  it("picks a suggestion with a click", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(input(), "harv");
    await user.click(await screen.findByRole("option", { name: /harvey\.net/ }));
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[0]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("picks with the arrow keys and Enter", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(input(), "harv");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[0]);
  });

  it("pre-highlights a suggestion only when the typed text is exactly its domain", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(input(), "harvey.ai");
    await waitFor(() => expect(screen.getByRole("option", { name: /harvey\.ai/ })).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it("Enter with nothing highlighted submits the text as typed", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const onSubmitRaw = vi.fn();
    const onPick = vi.fn();
    render(<Harness onSubmitRaw={onSubmitRaw} onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(input(), "harv ");
    await screen.findAllByRole("option");
    await user.keyboard("{Enter}");
    expect(onSubmitRaw).toHaveBeenCalledWith("harv");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Escape closes the list without reaching a surrounding handler; Tab and blur close it too", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness />
      </div>,
    );
    const user = userEvent.setup();
    await user.type(input(), "harv");
    await screen.findAllByRole("option");
    outer.mockClear();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(outer).not.toHaveBeenCalled();

    fireEvent.focus(input());
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.focus(input());
    fireEvent.blur(input());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Backspace in an empty box calls onBackspaceEmpty", async () => {
    const onBackspaceEmpty = vi.fn();
    render(<Harness onBackspaceEmpty={onBackspaceEmpty} />);
    await userEvent.setup().type(input(), "{Backspace}");
    expect(onBackspaceEmpty).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when suggestions fail to load", async () => {
    const calls = apiError("get", "/api/people-search/suggest", 502);
    render(<Harness />);
    await userEvent.setup().type(input(), "harv");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clears old suggestions when the text gets too short", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(input(), "harv");
    await screen.findAllByRole("option");
    await user.clear(input());
    await user.type(input(), "h");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("follows the box when the page scrolls or resizes", async () => {
    api("get", "/api/people-search/suggest", SUGGESTIONS);
    render(<Harness />);
    await userEvent.setup().type(input(), "harv");
    await screen.findAllByRole("option");
    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("CompanyLogo", () => {
  it("shows Hunter's logo, falling back to an icon if it fails to load", () => {
    const { container } = render(<CompanyLogo domain="stripe.com" size={30} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://logos.hunter.io/stripe.com");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows an icon without a domain", () => {
    const { container } = render(<CompanyLogo domain={null} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
