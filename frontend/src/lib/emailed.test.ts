import { describe, expect, it } from "vitest";
import { person } from "@/test/fixtures";
import { api } from "@/test/server";
import { applyEmailed, checkEmailed, EMAILED_PIECE } from "./emailed";

const JANE = person();
const SAM = person({ email: "sam@stripe.com" });
const status = (email: string, already_emailed_at: string | null = null, in_batch = false) => ({ email, already_emailed_at, in_batch });

describe("checkEmailed", () => {
  it("asks once per address, a piece at a time", async () => {
    const calls = api("post", "/api/people-search/emailed", ({ body }) => ({
      people: (body as { emails: string[] }).emails.map((e) => status(e)),
    }));
    const emails = Array.from({ length: EMAILED_PIECE + 1 }, (_, i) => `p${i}@x.com`);
    const out = await checkEmailed([...emails, "p0@x.com"]);
    expect(calls.map((c) => (c.body as { emails: string[] }).emails.length)).toEqual([EMAILED_PIECE, 1]);
    expect(out).toHaveLength(EMAILED_PIECE + 1);
  });
});

describe("applyEmailed", () => {
  const result = { query: "stripe.com", people: [JANE, SAM], selected: [JANE.email, SAM.email] };

  it("flags and unticks people emailed since the search", () => {
    const [r] = applyEmailed([result], [status(JANE.email, "2026-11-25T14:00:00Z"), status(SAM.email)]);
    expect(r.people[0]).toMatchObject({ already_emailed_at: "2026-11-25T14:00:00Z", in_batch: false });
    expect(r.people[1]).toBe(SAM);
    expect(r.selected).toEqual([SAM.email]);
    expect(r.query).toBe("stripe.com");
  });

  it("unticks people put in a batch, and keeps them unticked when the batch sends", () => {
    const [queued] = applyEmailed([result], [status(SAM.email, null, true)]);
    expect(queued.people[1].in_batch).toBe(true);
    expect(queued.selected).toEqual([JANE.email]);

    // Ticked again by hand while waiting: the email going out unticks them once more.
    const [sent] = applyEmailed([{ ...queued, selected: [SAM.email] }], [status(SAM.email, "2026-11-25T14:00:00Z")]);
    expect(sent.people[1]).toMatchObject({ already_emailed_at: "2026-11-25T14:00:00Z", in_batch: false });
    expect(sent.selected).toEqual([]);
  });

  it("leaves a choice alone when nothing new happened", () => {
    const emailed = { ...result, people: [person({ already_emailed_at: "2026-03-01T12:00:00Z" })], selected: [JANE.email] };
    const out = applyEmailed([emailed], [status(JANE.email, "2026-03-01T12:00:00Z")]);
    expect(out[0]).toBe(emailed); // ticked on purpose before: stays ticked, same object

    // A cancelled batch clears the badge without ticking anyone.
    const waiting = { ...result, people: [person({ in_batch: true })], selected: [] };
    const [cleared] = applyEmailed([waiting], [status(JANE.email)]);
    expect(cleared.people[0].in_batch).toBe(false);
    expect(cleared.selected).toEqual([]);
  });
});
