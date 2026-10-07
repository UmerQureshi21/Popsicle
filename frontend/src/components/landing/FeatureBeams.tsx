"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { boxIn, clamp, curve, lengthAtY, lightUp, line, useMeasure, useReadingLine, type Pt } from "./beams";
import { BEAM_THEMES, type BeamTheme } from "./HowItWorks";

type Geo = { w: number; h: number; top: Pt; bottom: Pt; spurs: { d: string; y: number }[] };

/**
 * A light trail down the gap between the feature cards, with a short branch into each card.
 * As you scroll, a particle runs down it and each card glows as the particle reaches it. Only
 * on two-column layouts; on phones the cards stack plainly.
 */
export default function FeatureBeams({ children, theme = "light" }: { children: ReactNode; theme?: BeamTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const id = useId().replace(/:/g, "");

  useMeasure(ref, () => {
    const el = ref.current;
    const cards = el ? [...el.querySelectorAll("[data-beam-card]")] : [];
    if (!el || cards.length < 2) return;
    const boxes = cards.map((c) => boxIn(c, el));
    if (Math.abs(boxes[0].top - boxes[1].top) > 4) {
      setGeo(null); // one column: no beams
      return;
    }
    const gapX = (boxes[0].right + boxes[1].left) / 2;
    const last = boxes[boxes.length - 1];
    setGeo({
      w: el.clientWidth,
      h: el.clientHeight,
      top: { x: gapX, y: boxes[0].top + 32 },
      bottom: { x: gapX, y: last.bottom - 32 },
      spurs: boxes.map((b) => {
        const y = b.top + b.height / 2;
        const edge = b.left < gapX ? b.right : b.left;
        return { d: curve({ x: gapX, y: y - 44 }, { x: edge, y }, 0), y };
      }),
    });
  });

  const frame = useCallback(
    (y: number) => {
      const el = ref.current;
      if (!el) return;
      const cards = el.querySelectorAll("[data-beam-card]");
      if (!geo) {
        cards.forEach((c) => c.removeAttribute("data-lit"));
        return;
      }
      el.querySelectorAll<SVGPathElement>("[data-lit-path]").forEach((p) => {
        if (typeof p.getTotalLength !== "function") return;
        const total = p.getTotalLength();
        lightUp(p, total, lengthAtY(p, total, y));
      });
      const dot = el.querySelector<SVGGElement>("[data-particle]");
      if (dot) {
        dot.setAttribute("transform", `translate(${geo.top.x} ${clamp(y, geo.top.y, geo.bottom.y)})`);
        dot.style.opacity = y >= geo.top.y && y <= geo.bottom.y + 40 ? "1" : "0";
      }
      cards.forEach((c, i) => c.toggleAttribute("data-lit", geo.spurs[i] !== undefined && y >= geo.spurs[i].y));
    },
    [geo],
  );
  useReadingLine(ref, frame, [frame]);

  const paths = geo ? [line(geo.top, geo.bottom), ...geo.spurs.map((s) => s.d)] : [];

  return (
    <div ref={ref} className="relative" style={BEAM_THEMES[theme]}>
      {geo && (
        <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={geo.w} height={geo.h}>
          <defs>
            <linearGradient id={`${id}-line`} gradientUnits="userSpaceOnUse" x1={geo.top.x} y1={geo.top.y} x2={geo.bottom.x} y2={geo.bottom.y}>
              <stop offset="0" stopColor="#d90429" />
              <stop offset="1" stopColor="#a26bff" />
            </linearGradient>
            <filter id={`${id}-glow`} x="-2" y="-2" width="5" height="5">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {paths.map((d, i) => (
            <path key={`track-${i}`} d={d} fill="none" stroke="var(--beam-track)" strokeWidth={1.25} />
          ))}
          {paths.map((d, i) => (
            <path
              key={`lit-${i}`}
              data-lit-path
              d={d}
              fill="none"
              stroke={`url(#${id}-line)`}
              strokeWidth={i === 0 ? 2 : 1.5}
              strokeLinecap="round"
              style={{ strokeDasharray: 100000, strokeDashoffset: 100000 }}
            />
          ))}
          <g data-particle style={{ opacity: 0, transition: "opacity 300ms" }}>
            <circle r={12} fill="var(--beam-halo)" filter={`url(#${id}-glow)`} />
            <circle r={4} fill="var(--beam-core)" />
          </g>
        </svg>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
