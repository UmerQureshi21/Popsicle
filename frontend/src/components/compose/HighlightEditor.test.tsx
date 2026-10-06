import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import HighlightEditor, { type EditorHandle } from "./HighlightEditor";

function Harness({ initial = "", singleLine = false, editor }: { initial?: string; singleLine?: boolean; editor?: React.Ref<EditorHandle> }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <HighlightEditor ref={editor} ariaLabel="Body" value={value} onChange={setValue} known={new Set(["first_name"])} singleLine={singleLine} minHeight={100} />
      <output>{value}</output>
    </>
  );
}

describe("HighlightEditor", () => {
  it("highlights known and unknown placeholders", () => {
    const { container } = render(<Harness initial="Hi {{First_Name}}, about {{team}}" />);
    expect(container.querySelector(".placeholder-chip")).toHaveTextContent("{{First_Name}}");
    expect(container.querySelector(".placeholder-chip-unknown")).toHaveTextContent("{{team}}");
  });

  it("edits as a normal textarea", async () => {
    const onFocus = vi.fn();
    render(<HighlightEditor ariaLabel="Body" value="" onChange={() => {}} known={new Set()} onFocus={onFocus} />);
    await userEvent.setup().click(screen.getByRole("textbox", { name: "Body" }));
    expect(onFocus).toHaveBeenCalled();
  });

  it("keeps a single-line editor on one line", async () => {
    render(<Harness singleLine />);
    const box = screen.getByRole("textbox", { name: "Body" });
    await userEvent.setup().type(box, "Hello{Enter}there");
    expect(screen.getByRole("status")).toHaveTextContent("Hellothere");
    fireEvent.change(box, { target: { value: "a\nb" } });
    expect(screen.getByRole("status")).toHaveTextContent("a b");
  });

  it("allows new lines in a multi-line editor", async () => {
    render(<Harness />);
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Body" }), "a{Enter}b");
    expect(screen.getByRole("status").textContent).toBe("a\nb");
  });

  it("inserts text at the cursor and can be focused", async () => {
    const editor = createRef<EditorHandle>();
    render(<Harness initial="Hi !" editor={editor} />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
    box.setSelectionRange(3, 3);
    act(() => editor.current!.insert("{{first_name}}"));
    expect(screen.getByRole("status")).toHaveTextContent("Hi {{first_name}}!");
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe(17);

    box.blur();
    act(() => editor.current!.focus());
    expect(box).toHaveFocus();
  });
});
