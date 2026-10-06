import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Select from "./Select";

const OPTIONS = [
  { value: "gta", label: "Greater Toronto Area" },
  { value: "canada", label: "Anywhere in Canada", hint: "wide" },
  { value: "any", label: "Anywhere" },
];

function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("canada");
  return (
    <>
      <Select
        ariaLabel="Location"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={OPTIONS}
      />
      <p>outside</p>
    </>
  );
}

const button = () => screen.getByRole("button", { name: "Location" });
const active = () => screen.getByRole("listbox").getAttribute("aria-activedescendant");

describe("Select", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the selected option and its hint", () => {
    render(<Harness />);
    expect(button()).toHaveTextContent("Anywhere in Canadawide");
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("picks an option with the mouse", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(button());
    expect(screen.getByRole("option", { name: /Anywhere in Canada/ })).toHaveAttribute("aria-selected", "true");
    await user.hover(screen.getByRole("option", { name: "Anywhere" }));
    await user.click(screen.getByRole("option", { name: "Anywhere" }));
    expect(onChange).toHaveBeenCalledWith("any");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button()).toHaveFocus();
  });

  it("toggles closed when the button is clicked again", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(button());
    await user.click(button());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("works from the keyboard", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const list = () => screen.getByRole("listbox");

    fireEvent.keyDown(button(), { key: "a" }); // ignored
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(button(), { key: "ArrowDown" });
    expect(active()).toMatch(/opt-1$/);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    expect(active()).toMatch(/opt-2$/);
    fireEvent.keyDown(list(), { key: "Home" });
    expect(active()).toMatch(/opt-0$/);
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    expect(active()).toMatch(/opt-0$/);
    fireEvent.keyDown(list(), { key: "End" });
    fireEvent.keyDown(list(), { key: "x" }); // ignored
    fireEvent.keyDown(list(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("any");

    fireEvent.keyDown(button(), { key: " " });
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    fireEvent.keyDown(list(), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith("canada");

    fireEvent.keyDown(button(), { key: "Enter" });
    fireEvent.keyDown(list(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button()).toHaveFocus();

    fireEvent.keyDown(button(), { key: "ArrowUp" });
    fireEvent.keyDown(list(), { key: "Tab" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on a click outside", async () => {
    render(<Harness />);
    await userEvent.setup().click(button());
    fireEvent.mouseDown(screen.getByRole("option", { name: "Anywhere" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens upward when there's no room below, and aligns right near the edge", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 700, bottom: 740, left: 900, right: 1000, width: 100, height: 40, x: 900, y: 700, toJSON: () => ({}),
    });
    render(<Harness />);
    await userEvent.setup().click(button());
    const style = screen.getByRole("listbox").style;
    expect(style.bottom).not.toBe("");
    expect(style.top).toBe("");
    expect(style.right).toBe("24px"); // window is 1024 wide in jsdom
    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("falls back to the first option when the value isn't one of them", () => {
    render(<Select ariaLabel="Size" value={99} onChange={() => {}} options={[{ value: 5, label: "Five" }]} />);
    expect(screen.getByRole("button", { name: "Size" })).toHaveTextContent("Five");
  });
});
