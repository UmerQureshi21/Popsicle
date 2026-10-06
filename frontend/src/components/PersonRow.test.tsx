import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { person } from "@/test/fixtures";
import PersonRow, { ConfidencePill } from "./PersonRow";

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

describe("PersonRow", () => {
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
    expect(screen.getByText(/emailed Mar/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();

    expect(screen.getByRole("link", { name: "LinkedIn profile" })).toHaveAttribute("target", "_blank");
    await userEvent.setup().click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("falls back to the email and 'No title listed'", () => {
    render(<PersonRow person={person({ full_name: null, position: null, seniority: null })} selected={false} onToggle={() => {}} />);
    expect(screen.getAllByText("jane@stripe.com").length).toBeGreaterThan(1);
    expect(screen.getByText("No title listed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
