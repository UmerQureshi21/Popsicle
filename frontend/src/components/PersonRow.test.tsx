import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { person } from "@/test/fixtures";
import PersonRow, { ConfidencePill, EmailedCount } from "./PersonRow";

describe("ConfidencePill", () => {
  it.each([
    [95, "emerald"],
    [75, "bg-cloud"],
    [40, "crimson"],
  ])("%d%% is shown as %s", (value, style) => {
    render(<ConfidencePill value={value} />);
    expect(screen.getByText(`${value}%`).className).toContain(style);
  });

  it("shows nothing without a score", () => {
    const { container } = render(<ConfidencePill value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EmailedCount", () => {
  it("counts the people already emailed, in red", () => {
    const people = [person(), person({ already_emailed_at: "2026-03-01T12:00:00Z" }), person({ already_emailed_at: "2026-04-01T12:00:00Z" })];
    render(<EmailedCount people={people} />);
    const count = screen.getByText(/2 already emailed/);
    expect(count.className).toContain("text-crimson");
  });

  it("shows nothing when nobody has been emailed", () => {
    const { container } = render(<EmailedCount people={[person()]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PersonRow", () => {
  it.each(["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>"])(
    "never turns a dangerous link into something clickable: %s",
    (link) => {
      render(<PersonRow person={person({ linkedin_url: link })} selected={false} onToggle={() => {}} />);
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(document.querySelector('a[href^="javascript"], a[href^="data"]')).toBeNull();
    },
  );

  it("shows the person and toggles when clicked", async () => {
    const onToggle = vi.fn();
    render(
      <PersonRow
        person={person({ linkedin_url: "https://linkedin.com/in/jane", already_emailed_at: "2026-03-01T12:00:00Z" })}
        selected
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Software Engineer · senior level")).toBeInTheDocument();
    expect(screen.getByText(/Already emailed · Mar/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();

    expect(screen.getByRole("link", { name: "LinkedIn profile" })).toHaveAttribute("target", "_blank");
    await userEvent.setup().click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("flags someone already emailed with a red row and badge", () => {
    render(<PersonRow person={person({ already_emailed_at: "2026-03-01T12:00:00Z" })} selected={false} onToggle={() => {}} />);
    const row = screen.getByRole("checkbox").closest("label")!;
    expect(row).toHaveAttribute("data-already-emailed", "true");
    expect(row.className).toContain("bg-crimson/[0.07]");
    expect(row.className).toContain("inset_4px_0_0_var(--color-crimson)");
    const badge = screen.getByText(/Already emailed · Mar 1/);
    expect(badge.className).toContain("bg-crimson");
    expect(badge).toHaveAttribute("title", "You've emailed this person before");
  });

  it("keeps the red warning even when the emailed person is ticked", () => {
    render(<PersonRow person={person({ already_emailed_at: "2026-03-01T12:00:00Z" })} selected onToggle={() => {}} />);
    const row = screen.getByRole("checkbox").closest("label")!;
    expect(row.className).toContain("bg-crimson/[0.07]");
    expect(row.className).not.toContain("bg-cloud/60");
  });

  it("uses grey, not red, for a ticked person who hasn't been emailed", () => {
    render(<PersonRow person={person({ already_emailed_at: null })} selected onToggle={() => {}} />);
    const row = screen.getByRole("checkbox").closest("label")!;
    expect(row).not.toHaveAttribute("data-already-emailed");
    expect(row.className).toContain("bg-cloud/60");
    expect(row.className).not.toContain("crimson");
    expect(screen.queryByText(/Already emailed/)).not.toBeInTheDocument();
  });

  it("falls back to the email and 'No title listed'", () => {
    render(<PersonRow person={person({ full_name: null, position: null, seniority: null })} selected={false} onToggle={() => {}} />);
    expect(screen.getAllByText("jane@stripe.com").length).toBeGreaterThan(1);
    expect(screen.getByText("No title listed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
