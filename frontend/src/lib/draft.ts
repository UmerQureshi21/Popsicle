import type { Attachment, FoundPerson } from "./api";
import { peopleToRows, readHandoff } from "./people";
import { parseTuples } from "./tuples";

/** The Compose page's work in progress, saved in localStorage so a refresh doesn't lose it. */
export type Draft = {
  company: string;
  variables: string[];
  rows: Record<string, string>[]; // one per recipient, keyed by variable name
  subject: string;
  body: string;
  attachments: Attachment[];
  delaySeconds: number;
  skipAlreadySent: boolean;
  templateId: number | null;
};

export const STORAGE_KEY = "cold-emailer:compose-draft:v1";

export const DEFAULT_DRAFT: Draft = {
  company: "",
  variables: ["full_name", "email"],
  rows: [{}],
  subject: "Quick question about {{company}}",
  body: "Hi {{first_name}},\n\nI came across your profile while looking into {{company}} and was really interested in the work your team is doing.\n\n…\n\nWould you be open to a quick 15-minute chat sometime next week?\n\nBest,\nUmer",
  attachments: [],
  delaySeconds: 30,
  skipAlreadySent: true,
  templateId: null,
};

export function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { tuplesText, ...rest } = JSON.parse(saved);
      const draft: Draft = { ...DEFAULT_DRAFT, ...rest };
      // Drafts from before the recipients table stored pasted tuples as text.
      if (!rest.rows && tuplesText) {
        const rows = parseTuples(tuplesText).map(({ values }) =>
          Object.fromEntries(draft.variables.map((v, i) => [v, values[i] ?? ""])),
        );
        if (rows.length) draft.rows = rows;
      }
      return draft;
    }
  } catch {}
  return DEFAULT_DRAFT;
}

/**
 * Add found people to the recipient rows, skipping anyone already in them. Blank rows are
 * dropped, and a single blank row is kept if that leaves nothing.
 */
export function addPeople(
  rows: Record<string, string>[],
  variables: string[],
  people: FoundPerson[],
): { variables: string[]; rows: Record<string, string>[]; added: number } {
  const existing = new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean));
  const kept = rows.filter((r) => Object.values(r).some((v) => v?.trim()));
  const { variables: vars, rows: added } = peopleToRows(
    people.filter((p) => !existing.has(p.email)),
    variables,
  );
  return { variables: vars, rows: kept.length + added.length ? [...kept, ...added] : [{}], added: added.length };
}

/** The saved draft, with people sent over from the Find people page loaded as a fresh batch. */
export function loadInitial(): { draft: Draft; notice: string | null } {
  const draft = loadDraft();
  const handoff = readHandoff();
  if (!handoff?.people.length) return { draft, notice: readGmailNotice() };
  const n = handoff.people.length;
  if (handoff.mode === "append") {
    const { variables, rows, added } = addPeople(draft.rows, draft.variables, handoff.people);
    return {
      draft: { ...draft, variables, rows, company: draft.company || handoff.company || "" },
      notice: added ? `Added ${added} ${added === 1 ? "person" : "people"} to this batch.` : "They're already in this batch.",
    };
  }
  const { variables, rows } = peopleToRows(handoff.people, draft.variables);
  return {
    draft: { ...draft, variables, rows, company: handoff.company ?? draft.company },
    notice: `Loaded ${n} ${n === 1 ? "person" : "people"}${handoff.company ? ` from ${handoff.company}` : ""}. Check the email below, then send.`,
  };
}

export function readGmailNotice(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("gmail") === "connected") return "Gmail connected. You’re ready to send.";
  if (params.get("gmail_error") === "missing_send_permission")
    return "Gmail wasn’t connected: the “Send email on your behalf” box was unticked. Click Connect Gmail and tick it.";
  if (params.get("gmail_error")) return `Couldn’t connect Gmail (${params.get("gmail_error")}). Try again.`;
  return null;
}
