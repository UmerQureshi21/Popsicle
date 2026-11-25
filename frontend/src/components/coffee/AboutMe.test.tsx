import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { api, apiError } from "@/test/server";
import AboutMe from "./AboutMe";

describe("AboutMe", () => {
  it("loads, edits and saves About me", async () => {
    api("get", "/api/profile", { about: "Who I am:" });
    const saves = api("put", "/api/profile", { about: "Who I am:\n- A student" });
    render(<AboutMe />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /About me/ }));
    const box = screen.getByRole("textbox", { name: "About me" });
    await waitFor(() => expect(box).toHaveValue("Who I am:"));
    await user.type(box, "\n- A student");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "About me" })).not.toBeInTheDocument());
    expect(saves[0].body).toEqual({ about: "Who I am:\n- A student" });
  });

  it("shows why it couldn't save, and Cancel closes it", async () => {
    api("get", "/api/profile", { about: "" });
    apiError("put", "/api/profile", 422, "Too long");
    render(<AboutMe />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /About me/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "About me" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Too long")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "About me" })).not.toBeInTheDocument();
  });

  it("shows why it couldn't load", async () => {
    apiError("get", "/api/profile", 500, "Server down");
    render(<AboutMe />);
    await userEvent.setup().click(screen.getByRole("button", { name: /About me/ }));
    expect(await screen.findByText("Server down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
