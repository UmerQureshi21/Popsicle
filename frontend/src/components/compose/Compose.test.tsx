import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment, CampaignDraft, GmailStatus } from "@/lib/api";
import { STORAGE_KEY } from "@/lib/draft";
import { readHandoff, saveHandoff } from "@/lib/people";
import { campaign, email, hunterStatus, person, search, template } from "@/test/fixtures";
import { api } from "@/test/server";
import Compose from "./Compose";

const CONNECTED: GmailStatus = { connected: true, email: "me@gmail.com", credentials_file_present: true };

function setup({ gmail = CONNECTED, draft }: { gmail?: GmailStatus; draft?: object } = {}) {
  if (draft) localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  const companies = api("get", "/api/companies", [{ id: 1, name: "Stripe" }]);
  api("get", "/api/templates", [template({ id: 4, name: "Role intro", subject: "About {{role}}", body: "Hi {{first_name}}", variables: ["role"] })]);
  api("get", "/api/gmail/status", gmail);
  render(<Compose />);
  return { companies, user: userEvent.setup() };
}

const sendButton = () => screen.getByRole("button", { name: "Send" });
const subject = () => screen.getByRole("textbox", { name: "Subject" });
const body = () => screen.getByRole("textbox", { name: "Email body" });
const cell = (row: number, variable: string) => screen.getByRole("textbox", { name: `Row ${row} ${variable}` });
const savedDraft = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

describe("Compose", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts with the default draft and says what's missing", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "me@gmail.com" })).toHaveAttribute("href", "http://localhost:8000/api/gmail/connect");
    expect(subject()).toHaveValue("Quick question about {{company}}");
    expect(screen.getByText("Add recipients below")).toBeInTheDocument();
    expect(screen.getByText("Add at least one recipient")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(document.querySelector('#company-options option[value="Stripe"]')).toBeInTheDocument());
  });

  it.each([
    [{ connected: false, email: null, credentials_file_present: true }, "Connect Gmail"],
    [{ connected: false, email: null, credentials_file_present: false }, "Gmail not set up"],
  ])("Gmail status %#", async (gmail, text) => {
    setup({ gmail });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("writes a batch, reviews it, sends it, and starts the next company", async () => {
    const preview = api("post", "/api/campaigns/preview", ({ body }) => {
      const d = body as CampaignDraft;
      return {
        items: d.rows.map((r, index) => ({ index, to_email: r.email, subject: "s", body: "b", values: r, status: "ready", issues: [], last_sent_at: null })),
        ready: d.rows.length,
        already_sent: 0,
        invalid: 0,
      };
    });
    const sent = campaign({ name: "Stripe batch", status: "completed", emails: [email({ status: "sent" })] });
    const create = api("post", "/api/campaigns", sent, 201);
    const { user, companies } = setup();

    await user.type(screen.getByPlaceholderText("e.g. Stripe"), "Stripe");
    await user.type(cell(1, "full_name"), "Jane Doe");
    await user.type(cell(1, "email"), "jane@stripe.com");
    expect(screen.getAllByText("1 recipient")).toHaveLength(2); // table header and send bar
    expect(sendButton()).toBeEnabled();

    await user.click(sendButton());
    expect(await screen.findByText("Review before sending")).toBeInTheDocument();
    expect(preview[0].body).toMatchObject({
      company: "Stripe",
      variables: ["full_name", "email"],
      rows: [{ full_name: "Jane Doe", email: "jane@stripe.com" }],
      attachment_ids: [],
      template_id: null,
      skip_already_sent: true,
      delay_seconds: 30,
    });
    await user.click(await screen.findByRole("button", { name: /Send 1 email/ }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Stripe batch");
    expect(create).toHaveLength(1);
    expect(screen.getByRole("link", { name: "View all sent" })).toHaveAttribute("href", "/sent");

    await user.click(screen.getByRole("button", { name: "Start next company" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Stripe")).toHaveValue("");
    expect(cell(1, "email")).toHaveValue("");
    await waitFor(() => expect(companies).toHaveLength(2));
  });

  it("the progress dialog can be closed", async () => {
    api("post", "/api/campaigns/preview", { items: [{ index: 0, to_email: "a@x.com", subject: "s", body: "b", values: {}, status: "ready", issues: [], last_sent_at: null }], ready: 1, already_sent: 0, invalid: 0 });
    api("post", "/api/campaigns", campaign({ status: "completed", emails: [] }), 201);
    const { user } = setup({ draft: { rows: [{ email: "a@x.com" }], company: "Stripe" } });
    await user.click(sendButton());
    await user.click(await screen.findByRole("button", { name: /Send 1 email/ }));
    await screen.findByRole("button", { name: "Start next company" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closing the review goes back to editing", async () => {
    api("post", "/api/campaigns/preview", { items: [], ready: 0, already_sent: 0, invalid: 0 });
    const { user } = setup({ draft: { rows: [{ email: "a@x.com" }], company: "Stripe" } });
    await user.click(sendButton());
    await user.click(await screen.findByRole("button", { name: "Back to editing" }));
    expect(screen.queryByText("Review before sending")).not.toBeInTheDocument();
  });

  it.each([
    [{ rows: [{ email: "nope" }] }, "1 recipient row needs fixing"],
    [{ rows: [{ email: "nope" }, { email: "bad" }] }, "2 recipient rows need fixing"],
    [{ rows: [{ email: "a@x.com" }], subject: "  " }, "Add a subject"],
    [{ rows: [{ email: "a@x.com" }], company: "Stripe", body: "{{team}}" }, "Unknown variable: team"],
    [{ rows: [{ email: "a@x.com" }], company: "Stripe", body: "{{team}} {{city}}" }, "Unknown variables: team, city"],
  ])("blocks sending: %#", async (draft, problem) => {
    setup({ draft });
    expect(await screen.findByText(problem)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("adds unknown placeholders as variables", async () => {
    const { user } = setup({ draft: { rows: [{ email: "a@x.com" }], company: "Stripe", body: "Hi {{team}}" } });
    expect(screen.getByText(/isn’t a variable/)).toHaveTextContent("{{team}} isn’t a variable");
    await user.click(screen.getByRole("button", { name: "Recipients" }));
    expect(screen.queryByRole("textbox", { name: "Row 1 email" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add as variable" }));
    expect(cell(1, "team")).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  it("says when several placeholders aren't variables", async () => {
    setup({ draft: { rows: [{ email: "a@x.com" }], body: "{{a}} {{b}}" } });
    expect(await screen.findByText(/aren’t variables/)).toHaveTextContent("{{a}}, {{b}} aren’t variables");
  });

  it("shows the first three recipients, then a count", async () => {
    setup({ draft: { rows: [{ email: "a@x.com" }, { email: "nope" }, { full_name: "No Email" }, { email: "d@x.com" }, { email: "e@x.com" }] } });
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getAllByText("missing email")).toHaveLength(2); // the chip and the table row
  });

  it("estimates how long a batch will take, and the delay can be changed", async () => {
    const { user } = setup({ draft: { rows: [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }], company: "Stripe" } });
    expect(screen.getByText("3 recipients · ~1 min")).toBeInTheDocument();
    await user.click(screen.getByText("Spacing between emails").previousElementSibling!);
    expect(screen.getByText("Wait ~30s between emails")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "120" } });
    expect(screen.getByText("Wait ~120s between emails")).toBeInTheDocument();
    expect(screen.getByText("3 recipients · ~4 min")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(savedDraft().delaySeconds).toBe(120);
  });

  it("can include people already emailed", async () => {
    const preview = api("post", "/api/campaigns/preview", { items: [], ready: 0, already_sent: 0, invalid: 0 });
    const { user } = setup({ draft: { rows: [{ email: "a@x.com" }], company: "Stripe" } });
    await user.click(screen.getByText("Already-emailed people").previousElementSibling!);
    await user.click(screen.getByRole("checkbox", { name: /Skip people I’ve already emailed/ }));
    await user.click(sendButton());
    await waitFor(() => expect(preview[0]?.body).toMatchObject({ skip_already_sent: false }));
  });

  it("inserts variables where you were typing", async () => {
    const { user } = setup({ draft: { subject: "Hi ", body: "Dear ", company: "Stripe" } });
    await user.click(body());
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "first_name" }));
    expect(body()).toHaveValue("Dear {{first_name}}");
    // The caret is put back on the next animation frame; let that happen before moving on.
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

    await user.click(subject());
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "company" }));
    expect(subject()).toHaveValue("Hi {{company}}");
  });

  it("loading a template adds the variables it uses and keeps existing columns", async () => {
    const { user } = setup({ draft: { subject: "", body: "", variables: ["full_name", "email", "team"] } });
    await user.click(await screen.findByRole("button", { name: /Untitled draft/ }));
    await user.click(await screen.findByText("Role intro"));
    expect(subject()).toHaveValue("About {{role}}");
    expect(cell(1, "team")).toBeInTheDocument();
    expect(cell(1, "role")).toBeInTheDocument();
    expect(savedDraft().templateId).toBe(4);

    await user.click(screen.getByRole("button", { name: /Role intro/ }));
    await user.click(screen.getByText("New blank draft"));
    expect(subject()).toHaveValue("");
    expect(savedDraft().templateId).toBeNull();
  });

  it("saving a draft remembers the template, and deleting it forgets it", async () => {
    let templates = [template({ id: 4, name: "Role intro" })];
    api("post", "/api/templates", () => {
      templates = [...templates, template({ id: 9, name: "Mine", subject: "x", body: "y" })];
      return templates[1];
    });
    api("delete", "/api/templates/9", () => {
      templates = templates.slice(0, 1);
      return new Response(null, { status: 204 });
    });
    const { user } = setup();
    api("get", "/api/templates", () => templates);
    await user.click(await screen.findByRole("button", { name: /Save draft/ }));
    await user.type(screen.getByPlaceholderText(/Learning more/), "Mine{Enter}");
    await waitFor(() => expect(savedDraft().templateId).toBe(9));

    await user.click(screen.getByRole("button", { name: /Untitled draft|Mine/ }));
    await user.click(await screen.findByRole("button", { name: "Delete Mine" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(savedDraft().templateId).toBeNull());
  });

  it("deleting a different template keeps the current one", async () => {
    let templates = [template({ id: 4, name: "Role intro" }), template({ id: 5, name: "Other" })];
    api("get", "/api/templates", () => templates);
    api("get", "/api/gmail/status", CONNECTED);
    api("get", "/api/companies", []);
    api("delete", "/api/templates/5", () => {
      templates = templates.slice(0, 1);
      return new Response(null, { status: 204 });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ templateId: 4 }));
    render(<Compose />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Role intro/ }));
    await user.click(screen.getByRole("button", { name: "Delete Other" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Other")).not.toBeInTheDocument());
    expect(savedDraft().templateId).toBe(4);
  });

  describe("attachments", () => {
    const upload = (...files: File[]) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });

    function fakeUploads(respond: (n: number) => Response) {
      const real = globalThis.fetch;
      let n = 0;
      // jsdom's FormData can't go through Node's fetch, so uploads are answered here.
      return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
        init?.body instanceof FormData ? Promise.resolve(respond(++n)) : real(input, init),
      );
    }

    it("uploads files, lists them and removes them", async () => {
      const attachment = (n: number): Attachment => ({ id: n, filename: n === 1 ? "resume.pdf" : "notes", content_type: "x", size_bytes: 2048 * n, created_at: "" });
      fakeUploads((n) => Response.json(attachment(n)));
      const { user } = setup();
      await user.click(screen.getByText("Attach files").previousElementSibling!);
      upload(new File(["a"], "resume.pdf"), new File(["b"], "notes"));
      expect(await screen.findByText("2 attachments")).toBeInTheDocument();
      expect(screen.getByText("resume.pdf")).toBeInTheDocument();
      expect(screen.getByText("4 kB")).toBeInTheDocument();
      // The draft is saved by an effect after the list renders, so wait for it.
      await waitFor(() => expect(savedDraft().attachments).toHaveLength(2));

      await user.click(screen.getByRole("button", { name: "Remove resume.pdf" }));
      expect(screen.getByText("1 attachment")).toBeInTheDocument();
    });

    it("says when an upload fails", async () => {
      fakeUploads(() => Response.json({ detail: "Attachments must be under 20 MB." }, { status: 413 }));
      setup();
      upload(new File(["a"], "huge.zip"));
      expect(await screen.findByText("Upload failed: Attachments must be under 20 MB.")).toBeInTheDocument();
    });

    it("ignores an empty file choice", () => {
      const spy = fakeUploads(() => Response.json({}));
      setup();
      upload();
      expect(spy.mock.calls.filter(([, init]) => init?.body instanceof FormData)).toHaveLength(0);
    });
  });

  it("loads people handed over from Find people, then forgets the handoff", async () => {
    saveHandoff({ company: "Stripe", people: [person()] });
    const { user } = setup();
    expect(await screen.findByText("Loaded 1 person from Stripe. Check the email below, then send.")).toBeInTheDocument();
    expect(cell(1, "email")).toHaveValue("jane@stripe.com");
    expect(cell(1, "role")).toHaveValue("Software Engineer");
    expect(readHandoff()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Loaded 1 person/)).not.toBeInTheDocument();
  });

  it("shows the Gmail connection result and tidies the URL", async () => {
    window.history.replaceState(null, "", "/compose?gmail=connected");
    setup();
    expect(await screen.findByText("Gmail connected. You’re ready to send.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("adds people found from the Find people button", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    api("post", "/api/people-search/company", search([person(), person({ email: "new@stripe.com", full_name: "New Person" })]));
    const { user } = setup({ draft: { rows: [{ full_name: "Jane", email: "jane@stripe.com" }] } });
    await user.click(screen.getByRole("button", { name: "Find people" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox", { name: "Company" }), "stripe.com");
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    await user.click(await within(dialog).findByRole("button", { name: /Add 2 to recipients/ }));

    expect(screen.getByText("Added 1 person to recipients (1 already in the list).")).toBeInTheDocument();
    expect(cell(2, "email")).toHaveValue("new@stripe.com");
    expect(screen.getByPlaceholderText("e.g. Stripe")).toHaveValue("Stripe");
  });

  it("adding found people keeps a company you typed and counts plurals", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    api("post", "/api/people-search/company", search([person({ email: "a@x.com" }), person({ email: "b@x.com" })]));
    const { user } = setup({ draft: { company: "Mine" } });
    await user.click(screen.getByRole("button", { name: "Find people" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Search" }));
    await user.click(await within(dialog).findByRole("button", { name: /Add 2 to recipients/ }));
    expect(screen.getByText("Added 2 people to recipients.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Stripe")).toHaveValue("Mine");
  });

  it("the Find people dialog can be closed", async () => {
    api("get", "/api/people-search/status", hunterStatus());
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Find people" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("works when Gmail status and companies can't be loaded", async () => {
    api("get", "/api/companies", { detail: "down" }, 500);
    api("get", "/api/templates", []);
    api("get", "/api/gmail/status", { detail: "down" }, 500);
    render(<Compose />);
    expect(await screen.findByText("Gmail not set up")).toBeInTheDocument();
  });
});
