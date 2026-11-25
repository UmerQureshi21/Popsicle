import { api, type EmailedStatus, type FoundPerson } from "@/lib/api";
import { inPieces } from "@/lib/pieces";

export const EMAILED_PIECE = 500; // addresses per request (the backend's limit)

/** Results that list people and which of them are ticked, like a company in Find people. */
type Picks = { people: FoundPerson[]; selected: string[] };

/** Ask the backend who among these addresses has been emailed, or is waiting in a batch. Free: no Hunter call. */
export async function checkEmailed(emails: string[]): Promise<EmailedStatus[]> {
  const unique = [...new Set(emails)];
  const out: EmailedStatus[] = [];
  for (const piece of inPieces(unique, EMAILED_PIECE)) {
    out.push(...(await api.post<{ people: EmailedStatus[] }>("/api/people-search/emailed", { emails: piece })).people);
  }
  return out;
}

/**
 * Saved results with each person's emailed status brought up to date. Someone emailed (or put in
 * a batch) since the search is flagged and unticked, so they aren't emailed twice by accident.
 * Results that didn't change are returned as they were, so nothing re-renders for no reason.
 */
export function applyEmailed<T extends Picks>(results: T[], statuses: EmailedStatus[]): T[] {
  const by = new Map(statuses.map((s) => [s.email, s]));
  return results.map((r) => {
    let changed = false;
    const unticked = new Set<string>();
    const people = r.people.map((p) => {
      const s = by.get(p.email);
      if (!s) return p;
      const inBatch = s.in_batch;
      if ((s.already_emailed_at && s.already_emailed_at !== p.already_emailed_at) || (inBatch && !p.in_batch)) {
        unticked.add(p.email);
      }
      if (s.already_emailed_at === p.already_emailed_at && inBatch === !!p.in_batch) return p;
      changed = true;
      return { ...p, already_emailed_at: s.already_emailed_at, in_batch: inBatch };
    });
    if (!changed) return r;
    return { ...r, people, selected: r.selected.filter((e) => !unticked.has(e)) };
  });
}
