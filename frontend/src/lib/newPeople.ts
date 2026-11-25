import type { NewPeople } from "@/lib/api";

export const NEW_PIECE = 25; // new people per request (the backend's limit)

/** One request for new people: how many more, where to start, and who the page already has. */
export type NewPeoplePiece = { want: number; offset: number; skip: string[] };

/**
 * Get up to `want` new people by asking a piece at a time, each carrying on where the last one
 * stopped, so no single request runs long (each walks at most 10 Hunter pages). Stops early when
 * Hunter has nobody left, or when a piece came back short: it used its page budget, and carrying on
 * could spend many more credits on one click (the next click carries on instead).
 */
export async function gatherNewPeople(want: number, ask: (piece: NewPeoplePiece) => Promise<NewPeople>): Promise<NewPeople> {
  let all: NewPeople | null = null;
  let offset = 0;
  while (!all || all.people.length < want) {
    const have: string[] = all ? all.people.map((p) => p.email) : [];
    const piece = { want: Math.min(NEW_PIECE, want - have.length), offset, skip: have };
    const res: NewPeople = await ask(piece);
    all = all
      ? {
          ...res,
          domain: all.domain ?? res.domain,
          organization: all.organization ?? res.organization,
          people: [...all.people, ...res.people],
          pages_checked: all.pages_checked + res.pages_checked,
          pages_paid: all.pages_paid + res.pages_paid,
        }
      : res;
    offset = res.next_offset;
    if (res.reached_end || res.people.length < piece.want) break;
  }
  return all;
}
