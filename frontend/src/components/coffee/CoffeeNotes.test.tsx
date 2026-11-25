import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, apiError } from "@/test/server";
import CoffeeNotes from "./CoffeeNotes";

const box = () => screen.getByRole("textbox", { name: "Coffee chat notes" });

describe("CoffeeNotes", () => {
  it("saves as you type, then the PDF links work", async () => {
    const saves = api("patch", "/api/contacts/7", { id: 7 });
    const onSaved = vi.fn();
    render(<CoffeeNotes contactId={7} initial="Why I am reaching out:" onSaved={onSaved} />);
    const user = userEvent.setup();
    expect(box()).toHaveValue("Why I am reaching out:");
    expect(screen.getByRole("link", { name: /Preview PDF/ })).toHaveAttribute("href", expect.stringMatching(/\/api\/contacts\/7\/coffee-chat\.pdf$/));
    expect(screen.getByRole("link", { name: /Download PDF/ })).toHaveAttribute("href", expect.stringMatching(/coffee-chat\.pdf\?download=1$/));

    await user.type(box(), "\n- Scaling");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Preview PDF/ })).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body).toEqual({ notes: "Why I am reaching out:\n- Scaling" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Why I am reaching out:\n- Scaling"));
    expect(screen.getByText(/is a heading/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Preview PDF/ })).toHaveAttribute("aria-disabled", "false");
  });

  it("says when it couldn't save, keeping your text", async () => {
    apiError("patch", "/api/contacts/7", 500, "boom");
    render(<CoffeeNotes contactId={7} initial="" />);
    await userEvent.setup().type(box(), "Hi");
    expect(await screen.findByText(/Couldn’t save/)).toBeInTheDocument();
    expect(box()).toHaveValue("Hi");
  });

  it("closing it with a change not yet saved saves it straight away", async () => {
    const saves = api("patch", "/api/contacts/7", { id: 7 });
    const { unmount } = render(<CoffeeNotes contactId={7} initial="" />);
    await userEvent.setup().type(box(), "Q");
    act(() => unmount());
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body).toEqual({ notes: "Q" });
  });
});
