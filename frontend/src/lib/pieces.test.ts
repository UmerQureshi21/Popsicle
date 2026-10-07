import { describe, expect, it } from "vitest";
import { inPieces, sleep } from "./pieces";

describe("inPieces", () => {
  it("splits into pieces of at most the given size", () => {
    expect(inPieces([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inPieces([1, 2], 5)).toEqual([[1, 2]]);
    expect(inPieces([], 3)).toEqual([]);
  });

  it("sleeps", async () => {
    const start = Date.now();
    await sleep(15);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});
