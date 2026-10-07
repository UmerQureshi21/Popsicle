import { describe, expect, it } from "vitest";
import { bowed, clamp, curve, lengthAtY, line } from "./beams";

// A straight vertical path from y=100 to y=300 (length 200).
const straight = { getPointAtLength: (l: number) => ({ x: 0, y: 100 + l }) };

describe("beams geometry", () => {
  it("draws curves and lines between points", () => {
    expect(curve({ x: 0, y: 0 }, { x: 100, y: 200 }, 40)).toBe("M 0 0 C 40 110, 106 120, 100 200");
    expect(bowed({ x: 50, y: 0 }, { x: 50, y: 100 }, -20)).toBe("M 50 0 C 30 30, 30 70, 50 100");
    expect(line({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe("M 1 2 L 3 4");
  });

  it("finds how far along a path its point at a height is", () => {
    expect(lengthAtY(straight, 200, 50)).toBe(0); // above the start
    expect(lengthAtY(straight, 200, 400)).toBe(200); // past the end
    expect(lengthAtY(straight, 200, 150)).toBeCloseTo(50, 3);
    expect(lengthAtY(straight, 0, 150)).toBe(0);
  });

  it("clamps", () => {
    expect([clamp(-1, 0, 1), clamp(0.5, 0, 1), clamp(2, 0, 1)]).toEqual([0, 0.5, 1]);
  });
});
