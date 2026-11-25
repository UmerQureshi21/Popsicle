import { describe, expect, it } from "vitest";
import type { NewPeople } from "@/lib/api";
import { person } from "@/test/fixtures";
import { gatherNewPeople, NEW_PIECE, type NewPeoplePiece } from "./newPeople";

/** A fake backend: `size` people (p0@x.com…) none emailed, 10 per page, like /company/new. */
function company(size: number, overrides: Partial<NewPeople> = {}) {
  const asks: NewPeoplePiece[] = [];
  const ask = async (piece: NewPeoplePiece): Promise<NewPeople> => {
    asks.push(piece);
    const people = Array.from({ length: size }, (_, i) => person({ email: `p${i}@x.com` }))
      .slice(piece.offset)
      .filter((p) => !piece.skip.includes(p.email))
      .slice(0, piece.want);
    const used = piece.offset + people.length + piece.skip.filter((e) => Number(e.slice(1).split("@")[0]) >= piece.offset).length;
    const reached_end = used >= size;
    const next_offset = reached_end ? size : Math.floor(used / 10) * 10;
    return {
      domain: asks.length === 1 ? "x.com" : null, organization: "X", pattern: null, total: size, people,
      reached_end, pages_checked: 3, pages_paid: 1, next_offset, ...overrides,
    };
  };
  return { ask, asks };
}

describe("gatherNewPeople", () => {
  it("asks once for 25 or fewer", async () => {
    const { ask, asks } = company(200);
    const res = await gatherNewPeople(10, ask);
    expect(res.people).toHaveLength(10);
    expect(asks).toEqual([{ want: 10, offset: 0, skip: [] }]);
  });

  it("gets 100 in pieces of 25, each carrying on where the last stopped", async () => {
    const { ask, asks } = company(200);
    const res = await gatherNewPeople(100, ask);
    expect(res.people.map((p) => p.email)).toEqual(Array.from({ length: 100 }, (_, i) => `p${i}@x.com`));
    expect(asks.map((a) => [a.want, a.offset, a.skip.length])).toEqual([
      [NEW_PIECE, 0, 0], [NEW_PIECE, 20, 25], [NEW_PIECE, 50, 50], [NEW_PIECE, 70, 75],
    ]);
    expect([res.pages_checked, res.pages_paid, res.domain, res.reached_end]).toEqual([12, 4, "x.com", false]);
  });

  it("stops when Hunter has nobody left", async () => {
    const { ask, asks } = company(40);
    const res = await gatherNewPeople(100, ask);
    expect([res.people.length, res.reached_end, asks.length]).toEqual([40, true, 2]);
  });

  it("stops when a piece comes back short, so one click can't walk every page", async () => {
    const { ask, asks } = company(200, { people: [person()], reached_end: false });
    const res = await gatherNewPeople(100, ask);
    expect([res.people.length, asks.length]).toEqual([1, 1]);
  });
});
