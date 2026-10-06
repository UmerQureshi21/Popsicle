import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { validateRows } from "@/lib/tuples";
import RecipientsTable from "./RecipientsTable";

type Row = Record<string, string>;

/** The table with real state, like Compose gives it. The current rows are shown as JSON. */
function Harness({ rows: initialRows = [{}], variables: initialVars = ["full_name", "email"] }: { rows?: Row[]; variables?: string[] }) {
  const [variables, setVariables] = useState(initialVars);
  const [rows, setRows] = useState(initialRows);
  return (
    <>
      <RecipientsTable variables={variables} onVariablesChange={setVariables} rows={rows} onRowsChange={setRows} recipients={validateRows(rows, variables)} />
      <pre data-testid="state">{JSON.stringify({ variables, rows })}</pre>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent!) as { variables: string[]; rows: Row[] };
const cell = (row: number, variable: string) => screen.getByRole("textbox", { name: `Row ${row} ${variable}` });

function paste(target: HTMLElement, text: string) {
  fireEvent.paste(target, { clipboardData: { getData: () => text } });
}

describe("RecipientsTable", () => {
  it("shows example placeholders in an empty first row", () => {
    render(<Harness variables={["full_name", "email", "team_lead"]} />);
    expect(cell(1, "full_name")).toHaveAttribute("placeholder", "Jane Doe");
    expect(cell(1, "email")).toHaveAttribute("placeholder", "jane@stripe.com");
    expect(cell(1, "team_lead")).toHaveAttribute("placeholder", "team lead");
    expect(screen.getByText("0 recipients")).toBeInTheDocument();
  });

  it("edits cells and counts recipients", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(cell(1, "full_name"), "Jane");
    await user.type(cell(1, "email"), "jane@stripe.com");
    expect(state().rows).toEqual([{ full_name: "Jane", email: "jane@stripe.com" }]);
    expect(screen.getByText("1 recipient")).toBeInTheDocument();
    expect(cell(1, "full_name")).toHaveAttribute("placeholder", "");
  });

  it("flags rows with a bad email", () => {
    render(<Harness rows={[{ full_name: "Jane", email: "nope" }, { full_name: "Sam" }]} />);
    expect(screen.getByText("2 rows need fixing")).toBeInTheDocument();
    expect(screen.getByText('"nope" isn\'t a valid email')).toBeInTheDocument();
    expect(screen.getByText("missing email")).toBeInTheDocument();
  });

  it("says one row needs fixing", () => {
    render(<Harness rows={[{ email: "nope" }]} />);
    expect(screen.getByText("1 row needs fixing")).toBeInTheDocument();
  });

  it("Enter moves down a row, adding one at the end; Shift+Enter adds a line break", async () => {
    render(<Harness rows={[{ email: "a@x.com" }, { email: "b@x.com" }]} />);
    const user = userEvent.setup();
    await user.click(cell(1, "email"));
    await user.keyboard("{Enter}");
    expect(cell(2, "email")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(state().rows).toHaveLength(3);
    expect(cell(3, "email")).toHaveFocus();

    await user.click(cell(1, "full_name"));
    await user.keyboard("Jane{Shift>}{Enter}{/Shift}Doe");
    expect(state().rows[0].full_name).toBe("Jane\nDoe");
  });

  it("clicking a cell focuses its text box", async () => {
    render(<Harness />);
    await userEvent.setup().click(cell(1, "email").parentElement!);
    expect(cell(1, "email")).toHaveFocus();
  });

  it("adds a recipient with the button and removes rows", async () => {
    render(<Harness rows={[{ email: "a@x.com" }]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add recipient/ }));
    expect(cell(2, "full_name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(state().rows).toEqual([{}]);
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(state().rows).toEqual([{}]); // the last row is cleared, not removed
  });

  it("adds variables (normalised, no duplicates) and removes them, but never email", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const add = screen.getByRole("textbox", { name: "Add variable" });
    await user.type(add, "Job Title{Enter}");
    await user.type(add, "job_title{Enter}");
    await user.type(add, "  ");
    await user.tab();
    expect(state().variables).toEqual(["full_name", "email", "job_title"]);

    await user.type(add, "team");
    await user.click(cell(1, "email")); // blur adds it
    expect(state().variables).toEqual(["full_name", "email", "job_title", "team"]);

    await user.click(screen.getByRole("button", { name: "Remove variable full_name" }));
    expect(state().variables).toEqual(["email", "job_title", "team"]);
    expect(screen.queryByRole("button", { name: "Remove variable email" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("required")).toBeInTheDocument();
  });

  it("pasting spreadsheet rows fills the table from that cell", () => {
    render(<Harness rows={[{ full_name: "Keep", email: "keep@x.com" }]} variables={["full_name", "email", "role"]} />);
    paste(cell(1, "email"), "jane@x.com\tEngineer\textra\r\nsam@x.com\tPM\n\n");
    expect(state().rows).toEqual([
      { full_name: "Keep", email: "jane@x.com", role: "Engineer" },
      { email: "sam@x.com", role: "PM" },
    ]);
  });

  it("pasting a paragraph keeps it in one cell", async () => {
    render(<Harness />);
    const target = cell(1, "full_name");
    paste(target, "line one\nline two");
    expect(state().rows).toEqual([{}]); // left to the browser's normal paste
    within(target.closest("tr")!).getByRole("textbox", { name: "Row 1 email" });
  });
});
