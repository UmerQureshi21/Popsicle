import { describe, expect, it } from "vitest";
import { person } from "@/test/fixtures";
import { DEFAULT_DRAFT, STORAGE_KEY, addPeople, loadDraft, loadInitial, readGmailNotice } from "./draft";
import { readHandoff, saveHandoff } from "./people";

const save = (draft: object) => localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

describe("loadDraft", () => {
  it("starts from the default draft", () => {
    expect(loadDraft()).toBe(DEFAULT_DRAFT);
  });

  it("restores a saved draft over the defaults", () => {
    save({ company: "Stripe", rows: [{ email: "j@x.com" }] });
    expect(loadDraft()).toEqual({ ...DEFAULT_DRAFT, company: "Stripe", rows: [{ email: "j@x.com" }] });
  });

  it("migrates old drafts that stored pasted tuples as text", () => {
    save({ tuplesText: '("Jane Doe", "j@x.com")\n("Sam")' });
    expect(loadDraft().rows).toEqual([
      { full_name: "Jane Doe", email: "j@x.com" },
      { full_name: "Sam", email: "" },
    ]);
  });

  it("keeps the default row when old pasted text was blank", () => {
    save({ tuplesText: "   " });
    expect(loadDraft().rows).toEqual([{}]);
  });

  it("ignores a corrupted draft", () => {
    localStorage.setItem(STORAGE_KEY, "{oops");
    expect(loadDraft()).toBe(DEFAULT_DRAFT);
  });
});

describe("addPeople", () => {
  it("adds new people after the filled rows, dropping blank ones", () => {
    const out = addPeople([{ email: "Jane@Stripe.com" }, { email: " " }], ["full_name", "email"], [
      person(),
      person({ email: "sam@stripe.com", full_name: "Sam Lee" }),
    ]);
    expect(out.added).toBe(1);
    expect(out.variables).toEqual(["full_name", "email", "role"]);
    expect(out.rows).toEqual([{ email: "Jane@Stripe.com" }, { full_name: "Sam Lee", email: "sam@stripe.com", role: "Software Engineer" }]);
  });

  it("keeps one blank row when there's nothing", () => {
    expect(addPeople([{}], ["email"], []).rows).toEqual([{}]);
  });
});

describe("loadInitial", () => {
  it("returns the saved draft and any Gmail notice when nothing was handed over", () => {
    window.history.replaceState(null, "", "/compose?gmail=connected");
    expect(loadInitial()).toEqual({ draft: DEFAULT_DRAFT, notice: "Gmail connected. You’re ready to send." });
  });

  it("starts a fresh batch with handed-over people", () => {
    save({ company: "Old", rows: [{ email: "old@x.com" }] });
    saveHandoff({ company: "Stripe", people: [person(), person({ email: "sam@stripe.com" })] });
    const { draft, notice } = loadInitial();
    expect(draft.company).toBe("Stripe");
    expect(draft.rows.map((r) => r.email)).toEqual(["jane@stripe.com", "sam@stripe.com"]);
    expect(notice).toBe("Loaded 2 people from Stripe. Check the email below, then send.");
    expect(readHandoff()).not.toBeNull(); // Compose clears it once applied
  });

  it("keeps the current company when the handoff has none", () => {
    save({ company: "Acme" });
    saveHandoff({ company: null, people: [person()] });
    const { draft, notice } = loadInitial();
    expect(draft.company).toBe("Acme");
    expect(notice).toBe("Loaded 1 person. Check the email below, then send.");
  });

  it("appends handed-over people to the current batch", () => {
    save({ company: "", rows: [{ full_name: "Sam", email: "sam@x.com" }] });
    saveHandoff({ company: "Harvey", people: [person({ email: "jane@harvey.ai" })], mode: "append" });
    const { draft, notice } = loadInitial();
    expect(draft.rows.map((r) => r.email)).toEqual(["sam@x.com", "jane@harvey.ai"]);
    expect(draft.company).toBe("Harvey");
    expect(notice).toBe("Added 1 person to this batch.");
  });

  it("appending several people, or nobody new", () => {
    save({ company: "Stripe", rows: [{ email: "jane@stripe.com" }] });
    saveHandoff({ company: null, people: [person(), person({ email: "a@x.com" }), person({ email: "b@x.com" })], mode: "append" });
    expect(loadInitial().notice).toBe("Added 2 people to this batch.");

    saveHandoff({ company: null, people: [person()], mode: "append" });
    const { draft, notice } = loadInitial();
    expect(notice).toBe("They're already in this batch.");
    expect(draft.company).toBe("Stripe");
  });

  it("an empty handoff is ignored", () => {
    saveHandoff({ company: "Stripe", people: [] });
    expect(loadInitial().draft).toBe(DEFAULT_DRAFT);
  });

  it("appending to an empty batch with no company anywhere", () => {
    saveHandoff({ company: null, people: [person()], mode: "append" });
    expect(loadInitial().draft.company).toBe("");
  });
});

describe("readGmailNotice", () => {
  it.each([
    ["", null],
    ["?gmail_error=missing_send_permission", "Gmail wasn’t connected: the “Send email on your behalf” box was unticked. Click Connect Gmail and tick it."],
    ["?gmail_error=access_denied", "Couldn’t connect Gmail (access_denied). Try again."],
  ])("%s", (search, notice) => {
    window.history.replaceState(null, "", `/compose${search}`);
    expect(readGmailNotice()).toBe(notice);
  });
});
