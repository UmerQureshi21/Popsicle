import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Template } from "@/lib/api";
import { template } from "@/test/fixtures";
import { api, apiError } from "@/test/server";
import TemplateBar from "./TemplateBar";

const INTRO = template({ id: 1, name: "Intro", subject: "Hi", body: "Hello" });
const FOLLOW = template({ id: 2, name: "Follow up", subject: "", body: "Again" });

function setup(props: Partial<React.ComponentProps<typeof TemplateBar>> = {}, templates: Template[] = [INTRO, FOLLOW]) {
  const list = api("get", "/api/templates", templates);
  const handlers = { onLoad: vi.fn(), onNew: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn() };
  const utils = render(<TemplateBar subject="" body="" variables={["email"]} templateId={null} {...handlers} {...props} />);
  return { ...utils, ...handlers, list, user: userEvent.setup() };
}

const menuButton = () => screen.getByRole("button", { expanded: false, name: /Untitled draft|Intro|Follow up/ });

describe("TemplateBar", () => {
  it("an untouched blank draft isn't marked as unsaved", async () => {
    const { list } = setup();
    await waitFor(() => expect(list).toHaveLength(1));
    expect(screen.getByText("Untitled draft")).toBeInTheDocument();
    expect(screen.queryByText("Not saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save draft/ })).toBeDisabled();
  });

  it("lists saved templates, newest edits first, and loads one", async () => {
    const { user, onLoad } = setup();
    await user.click(menuButton());
    expect(await screen.findByText("Hi · ", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/\(no subject\)/)).toBeInTheDocument();
    await user.click(screen.getByText("Follow up"));
    expect(onLoad).toHaveBeenCalledWith(FOLLOW);
  });

  it("shows loading and empty states", async () => {
    const { user, list } = setup({}, []);
    await user.click(menuButton());
    await waitFor(() => expect(list).toHaveLength(1));
    expect(await screen.findByText(/Nothing saved yet/)).toBeInTheDocument();
  });

  it("shows Loading… until templates arrive", async () => {
    api("get", "/api/templates", () => new Promise(() => {}));
    render(<TemplateBar subject="" body="" variables={[]} templateId={null} onLoad={vi.fn()} onNew={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />);
    await userEvent.setup().click(menuButton());
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("clicking the current template just closes the menu", async () => {
    const { user, onLoad } = setup({ templateId: 1, subject: "Hi", body: "Hello" });
    await screen.findByText("Intro");
    await user.click(screen.getByRole("button", { name: /Intro/ }));
    await user.click(screen.getAllByText("Intro")[1]);
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.queryByText("New blank draft")).not.toBeInTheDocument();
  });

  it("saves a new draft under a name", async () => {
    const saved = template({ id: 3, name: "Learning more" });
    const create = api("post", "/api/templates", saved, 201);
    const { user, onSaved, list } = setup({ subject: "Hey", body: "There" });
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save draft/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Save draft");
    await user.type(screen.getByPlaceholderText(/Learning more/), "  Learning more  {Enter}");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(create[0].body).toEqual({ name: "Learning more", subject: "Hey", body: "There", variables: ["email"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(list.length).toBe(2); // refreshed
  });

  it("an empty name isn't saved, and the dialog can be cancelled", async () => {
    const create = api("post", "/api/templates", {}, 201);
    const { user } = setup({ subject: "Hey", body: "" });
    await user.click(await screen.findByRole("button", { name: /Save draft/ }));
    await user.type(screen.getByPlaceholderText(/Learning more/), "   {Enter}");
    expect(create).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows why a save failed", async () => {
    apiError("post", "/api/templates", 409, 'A template named "Intro" already exists.');
    const { user } = setup({ subject: "Hey", body: "There" });
    await user.click(await screen.findByRole("button", { name: /Save draft/ }));
    await user.type(screen.getByPlaceholderText(/Learning more/), "Intro");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText('A template named "Intro" already exists.')).toBeInTheDocument();
  });

  it("saves edits to the loaded template", async () => {
    const updated = template({ id: 1, name: "Intro", subject: "Hi there" });
    const put = api("put", "/api/templates/1", updated);
    const { user, onSaved } = setup({ templateId: 1, subject: "Hi there", body: "Hello" });
    expect(await screen.findByText("Edited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(put[0].body).toEqual({ name: "Intro", subject: "Hi there", body: "Hello", variables: ["email"] });
  });

  it("shows a failed update", async () => {
    apiError("put", "/api/templates/1", 409, "Another template already has that name.");
    const { user } = setup({ templateId: 1, subject: "Changed", body: "Hello" });
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Another template already has that name.")).toBeInTheDocument();
  });

  it("an unchanged template says Saved", async () => {
    setup({ templateId: 1, subject: "Hi", body: "Hello" });
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("saves a copy under a new name", async () => {
    const create = api("post", "/api/templates", template({ id: 9, name: "Intro (copy)" }), 201);
    const { user } = setup({ templateId: 1, subject: "Hi", body: "Hello" });
    await user.click(await screen.findByRole("button", { name: "Save as new" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Save as a new template");
    expect(screen.getByRole("dialog")).toHaveTextContent("“Intro” stays as it was");
    expect(screen.getByDisplayValue("Intro (copy)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveLength(1));
  });

  it("deletes a template after confirming", async () => {
    const del = api("delete", "/api/templates/1", null, 204);
    const { user, onDeleted } = setup({ templateId: 1, subject: "Hi", body: "Hello" });
    await user.click(await screen.findByRole("button", { name: /Intro/ }));
    await user.click(screen.getByRole("button", { name: "Delete Intro" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1));
    expect(del).toHaveLength(1);
  });

  it("shows when templates can't be loaded", async () => {
    apiError("get", "/api/templates", 500, "Database is down");
    render(<TemplateBar subject="" body="" variables={[]} templateId={null} onLoad={vi.fn()} onNew={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText("Database is down")).toBeInTheDocument();
  });

  describe("unsaved changes", () => {
    it("switching away from a clean draft doesn't ask", async () => {
      const { user, onNew } = setup({ templateId: 1, subject: "Hi", body: "Hello" });
      await user.click(await screen.findByRole("button", { name: /Intro/ }));
      await user.click(screen.getByText("New blank draft"));
      expect(onNew).toHaveBeenCalled();
    });

    it("keep editing, or discard and switch", async () => {
      const { user, onNew } = setup({ subject: "Unsaved", body: "work" });
      await screen.findByText("Not saved");
      await user.click(menuButton());
      await user.click(screen.getByText("New blank draft"));
      expect(screen.getByRole("dialog")).toHaveTextContent("This draft hasn’t been saved.");
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(onNew).not.toHaveBeenCalled();

      await user.click(menuButton());
      await user.click(screen.getByText("New blank draft"));
      await user.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(onNew).toHaveBeenCalled();
    });

    it("save a new draft first, then switch", async () => {
      api("post", "/api/templates", template({ id: 5, name: "Mine" }), 201);
      const { user, onLoad, onSaved } = setup({ subject: "Unsaved", body: "work" });
      await screen.findByText("Not saved");
      await user.click(menuButton());
      await user.click(screen.getByText("Follow up"));
      await user.click(screen.getByRole("button", { name: "Save draft first" }));
      await user.type(screen.getByPlaceholderText(/Learning more/), "Mine{Enter}");
      await waitFor(() => expect(onLoad).toHaveBeenCalledWith(FOLLOW));
      expect(onSaved).toHaveBeenCalled();
    });

    it("save the loaded template first, then switch", async () => {
      api("put", "/api/templates/1", template());
      const { user, onLoad } = setup({ templateId: 1, subject: "Changed", body: "Hello" });
      await user.click(await screen.findByRole("button", { name: /Intro/ }));
      await user.click(screen.getByText("Follow up"));
      expect(screen.getByRole("dialog")).toHaveTextContent("Your changes to “Intro” haven’t been saved.");
      await user.click(screen.getByRole("button", { name: "Save “Intro” first" }));
      await waitFor(() => expect(onLoad).toHaveBeenCalledWith(FOLLOW));
    });

    it("doesn't switch if saving first fails", async () => {
      apiError("put", "/api/templates/1", 500, "nope");
      const { user, onLoad } = setup({ templateId: 1, subject: "Changed", body: "Hello" });
      await user.click(await screen.findByRole("button", { name: /Intro/ }));
      await user.click(screen.getByText("Follow up"));
      await user.click(screen.getByRole("button", { name: "Save “Intro” first" }));
      expect(await screen.findByText("nope")).toBeInTheDocument();
      expect(onLoad).not.toHaveBeenCalled();
    });
  });
});
