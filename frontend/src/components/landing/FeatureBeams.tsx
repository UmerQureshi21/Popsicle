"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { boxIn, cumulative, easeInOut, pointAlong, polyline, useMeasure, zigzag, type Pt } from "./beams";
import { BEAM_THEMES, type BeamTheme } from "./HowItWorks";

const FADE_MS = 600; // the cards appear first...
const RUN_MS = 4200; // ...then the particle runs the whole zigzag once

type Geo = { w: number; h: number; points: Pt[]; lengths: number[]; reachAt: number[] };

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * All the feature cards appear together when the section comes into view; then a particle
 * zigzags through them once (across the top row, down into the next row, back across, ...),
 * each card glowing as the particle reaches it. Only on two-column layouts; on phones the
 * cards just appear.
 */
export default function FeatureBeams({ children, theme = "light" }: { children: ReactNode; theme?: BeamTheme }) {
  const outer = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null); // the cards and the trail, which slide in together
  const [geo, setGeo] = useState<Geo | null>(null);
  const [shown, setShown] = useState(false);
  const played = useRef(false);
  const id = useId().replace(/:/g, "");

  useMeasure(ref, () => {
    const el = ref.current;
    const cards = el ? [...el.querySelectorAll("[data-beam-card]")] : [];
    if (!el || cards.length < 2) return;
    const boxes = cards.map((c) => boxIn(c, el));
    if (Math.abs(boxes[0].top - boxes[1].top) > 4) {
      setGeo(null); // one column
      return;
    }
    const { points, reach } = zigzag(boxes);
    const lengths = cumulative(points);
    setGeo({ w: el.clientWidth, h: el.clientHeight, points, lengths, reachAt: reach.map((i) => lengths[i]) });
  });

  // Show everything at once the first time the section scrolls into view.
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Then run the particle through the zigzag, once.
  useEffect(() => {
    const el = ref.current;
    if (!el || !shown || !geo) return;
    const total = geo.lengths[geo.lengths.length - 1];
    const path = el.querySelector<SVGPathElement>("[data-lit-path]");
    const dot = el.querySelector<SVGGElement>("[data-particle]");
    const cards = el.querySelectorAll("[data-beam-card]");
    const draw = (travelled: number, moving: boolean) => {
      if (path) {
        path.style.strokeDasharray = `${total}`;
        path.style.strokeDashoffset = `${total - travelled}`;
      }
      if (dot) {
        const p = pointAlong(geo.points, geo.lengths, travelled);
        dot.setAttribute("transform", `translate(${p.x} ${p.y})`);
        dot.style.opacity = moving ? "1" : "0";
      }
      cards.forEach((c, i) => c.toggleAttribute("data-lit", travelled >= geo.reachAt[i] - 0.5));
    };
    if (played.current || reducedMotion()) {
      played.current = true;
      draw(total, false); // already played (e.g. after a resize), or no motion wanted
      return;
    }
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / RUN_MS);
      draw(total * easeInOut(t), t < 1);
      if (t < 1) frame = requestAnimationFrame(tick);
      else played.current = true;
    };
    const wait = setTimeout(() => (frame = requestAnimationFrame(tick)), FADE_MS);
    return () => {
      clearTimeout(wait);
      cancelAnimationFrame(frame);
    };
  }, [shown, geo]);

  const d = geo ? polyline(geo.points) : "";

  return (
    <div ref={outer} data-shown={shown || undefined} style={BEAM_THEMES[theme]}>
      <div
        ref={ref}
        className={`relative transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
      >
        {geo && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={geo.w} height={geo.h}>
            <defs>
              <linearGradient id={`${id}-line`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geo.w * 0.3} y2={geo.h}>
                <stop offset="0" stopColor="#d90429" />
                <stop offset="0.6" stopColor="#ef233c" />
                <stop offset="1" stopColor="#a26bff" />
              </linearGradient>
              <filter id={`${id}-glow`} x="-2" y="-2" width="5" height="5">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <path d={d} fill="none" stroke="var(--beam-track)" strokeWidth={1.5} strokeLinejoin="round" />
            <path
              data-lit-path
              d={d}
              fill="none"
              stroke={`url(#${id}-line)`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: 100000, strokeDashoffset: 100000 }}
            />
            <g data-particle style={{ opacity: 0, transition: "opacity 300ms" }}>
              <circle r={12} fill="var(--beam-halo)" filter={`url(#${id}-glow)`} />
              <circle r={4} fill="var(--beam-core)" />
            </g>
          </svg>
        )}
        {/* The cards sit above the trail, so the particle passes underneath them. */}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
