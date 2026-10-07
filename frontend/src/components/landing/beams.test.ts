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

describe("feature cards zigzag", () => {
  // Two columns (x 0-100 and 140-240), three rows 100 tall with 40 gaps.
  const card = (col: number, row: number) => ({ left: col * 140, right: col * 140 + 100, top: row * 140, bottom: row * 140 + 100 });
  const six = [card(0, 0), card(1, 0), card(0, 1), card(1, 1), card(0, 2), card(1, 2)];

  it("snakes: across, down the right, back across, down the left, across", async () => {
    const { zigzag } = await import("./beams");
    const { points, reach } = zigzag(six);
    expect(points).toEqual([
      { x: 100, y: 50 }, // right side of top-left
      { x: 140, y: 50 }, // left side of top-right
      { x: 190, y: 100 }, // out through the bottom of top-right
      { x: 190, y: 140 }, // into the top of middle-right
      { x: 140, y: 190 }, // its left side
      { x: 100, y: 190 }, // right side of middle-left
      { x: 50, y: 240 }, // out through its bottom
      { x: 50, y: 280 }, // into the top of bottom-left
      { x: 100, y: 330 }, // its right side
      { x: 140, y: 330 }, // left side of bottom-right
    ]);
    // The point where the particle reaches each card, in card order.
    expect(reach).toEqual([0, 1, 5, 3, 7, 9]);
  });

  it("handles a lone last card and a single card", async () => {
    const { zigzag } = await import("./beams");
    expect(zigzag([card(0, 0), card(1, 0), card(0, 1)]).reach).toEqual([0, 1, 3]);
    expect(zigzag([card(0, 0)]).points).toEqual([{ x: 100, y: 50 }]);
  });

  it("measures and walks along the path", async () => {
    const { cumulative, pointAlong, polyline, easeInOut } = await import("./beams");
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 100 }];
    const lengths = cumulative(pts);
    expect(lengths).toEqual([0, 50, 110]);
    expect(pointAlong(pts, lengths, -5)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(pts, lengths, 25)).toEqual({ x: 15, y: 20 });
    expect(pointAlong(pts, lengths, 80)).toEqual({ x: 30, y: 70 });
    expect(pointAlong(pts, lengths, 999)).toEqual({ x: 30, y: 100 });
    expect(pointAlong([], [], 5)).toEqual({ x: 0, y: 0 });
    expect(polyline(pts)).toBe("M 0 0 L 30 40 L 30 100");
    expect([easeInOut(0), easeInOut(0.5), easeInOut(1)]).toEqual([0, 0.5, 1]);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });
});
