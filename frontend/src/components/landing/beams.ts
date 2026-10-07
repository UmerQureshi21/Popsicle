/**
 * Light trails for the landing page: faint SVG tracks that light up as a particle travels along
 * them. Everything is driven by scroll: the "reading line" (a fixed height in the viewport) is
 * where the particles are, so the story moves exactly as fast as you scroll, and backwards too.
 */
import { useEffect, type RefObject } from "react";

export type Pt = { x: number; y: number };

/** Where the reading line sits, as a share of the window's height. */
export const READING_LINE = 0.62;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coordinates rounded to 0.1px: short path strings, no floating-point noise. */
const r = (n: number) => Math.round(n * 10) / 10;

/** A smooth curve from `from` down to `to`, leaving sideways by `bend` before swinging in. */
export function curve(from: Pt, to: Pt, bend = 0): string {
  const dy = to.y - from.y;
  const c1 = { x: from.x + bend, y: from.y + dy * 0.55 };
  const c2 = { x: to.x + bend * 0.15, y: to.y - dy * 0.4 };
  return `M ${r(from.x)} ${r(from.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(to.x)} ${r(to.y)}`;
}

/** A curve from `from` to `to` that bows out sideways by `bow` (for a lens of lines alongside a trunk). */
export function bowed(from: Pt, to: Pt, bow: number): string {
  const dy = to.y - from.y;
  return `M ${r(from.x)} ${r(from.y)} C ${r(from.x + bow)} ${r(from.y + dy * 0.3)}, ${r(to.x + bow)} ${r(to.y - dy * 0.3)}, ${r(to.x)} ${r(to.y)}`;
}

export const line = (from: Pt, to: Pt) => `M ${r(from.x)} ${r(from.y)} L ${r(to.x)} ${r(to.y)}`;

type Measurable = { getPointAtLength(l: number): { x: number; y: number } };

/**
 * How far along a top-to-bottom path its point at height `y` is. Paths only ever head
 * downwards, so a binary search on the height finds it.
 */
export function lengthAtY(path: Measurable, total: number, y: number): number {
  if (total <= 0) return 0;
  const start = path.getPointAtLength(0).y;
  const end = path.getPointAtLength(total).y;
  if (y <= start) return 0;
  if (y >= end) return total;
  let lo = 0;
  let hi = total;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (path.getPointAtLength(mid).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Light a path up to `lit` of its `total` length (the rest stays a faint track). */
export function lightUp(path: SVGPathElement, total: number, lit: number) {
  path.style.strokeDasharray = `${total}`;
  path.style.strokeDashoffset = `${total - lit}`;
}

/** Element's box relative to `container`. */
export function boxIn(el: Element, container: Element) {
  const a = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { left: a.left - c.left, top: a.top - c.top, right: a.right - c.left, bottom: a.bottom - c.top, width: a.width, height: a.height };
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Calls `frame(y)` whenever the page scrolls or resizes, with the reading line's height inside
 * `container`. With reduced motion asked for, `y` is Infinity: everything shows fully lit.
 */
export function useReadingLine(container: RefObject<HTMLElement | null>, frame: (y: number) => void, deps: unknown[]) {
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let queued = 0;
    const run = () => {
      queued = 0;
      frame(reducedMotion() ? Infinity : window.innerHeight * READING_LINE - el.getBoundingClientRect().top);
    };
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(run);
    };
    run();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (queued) cancelAnimationFrame(queued);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Watches `container`'s size and calls `measure` (on mount too). */
export function useMeasure(container: RefObject<HTMLElement | null>, measure: () => void) {
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
