"use client";

import Image from "next/image";
import { useCallback, useId, useRef, useState } from "react";
import { Inbox, PenLine, Send, UserSearch, Video } from "lucide-react";
import { boxIn, bowed, clamp, curve, lengthAtY, lightUp, line, useMeasure, useReadingLine, type Pt } from "./beams";

const STEPS = [
  {
    icon: UserSearch,
    title: "Find the right people",
    text: "Pick a company from the suggestions, then filter by job title and location.",
    example: "engineers at meta.com",
  },
  {
    icon: PenLine,
    title: "Write one email",
    text: "Drop in variables where each person’s details go, and save it as a template.",
    example: "Hi {{first_name}},",
  },
  {
    icon: Send,
    title: "Send from your Gmail",
    text: "Check every email, then send now or schedule it for the morning. Never to anyone twice.",
    example: "Tue · 9:00 AM",
  },
  {
    icon: Inbox,
    title: "Follow every reply",
    text: "Each conversation lands in your Inbox, so you see who wrote back at a glance.",
    example: "2 new replies",
  },
  {
    icon: Video,
    title: "Book the call",
    text: "When they say yes, pick a time and Popsicle sends a Google Meet link and invite.",
    example: "Coffee chat · Fri 2 PM",
  },
];

export type BeamTheme = "light" | "dark";

/** Colours of the tracks and particles, per theme (light for now; dark to experiment with). */
export const BEAM_THEMES: Record<BeamTheme, React.CSSProperties> = {
  light: {
    "--beam-track": "rgba(141, 153, 174, 0.32)",
    "--beam-core": "#d90429",
    "--beam-halo": "rgba(239, 35, 60, 0.45)",
  } as React.CSSProperties,
  dark: {
    "--beam-track": "rgba(255, 255, 255, 0.12)",
    "--beam-core": "#ffffff",
    "--beam-halo": "rgba(255, 255, 255, 0.55)",
  } as React.CSSProperties,
};

type Geo = { w: number; h: number; hunter: Pt; gmail: Pt; merge: Pt; end: Pt; dots: number[] };
type Track = { d: string; gradient: "hunter" | "gmail" | "trunk"; main?: "hunter" | "gmail" | "trunk"; width: number };

/** Three curves from a source down to where the paths merge; the middle one carries the particle. */
function fan(from: Pt, to: Pt, name: "hunter" | "gmail", w: number): Track[] {
  const spread = Math.min(110, w * 0.11);
  return [-1, 0, 1].map((k) => ({
    d: curve({ x: from.x + k * 10, y: from.y }, to, k * spread),
    gradient: name,
    main: k === 0 ? name : undefined,
    width: k === 0 ? 2 : 1.25,
  }));
}

function tracks(g: Geo): Track[] {
  const bow = g.w < 640 ? 9 : Math.min(46, g.w * 0.05); // tighter on phones, where the trunk hugs the text
  return [
    ...fan(g.hunter, g.merge, "hunter", g.w),
    ...fan(g.gmail, g.merge, "gmail", g.w),
    { d: line(g.merge, g.end), gradient: "trunk", main: "trunk", width: 2 },
    // A faint lens of lines alongside the trunk, like strands of the same pipeline.
    { d: bowed(g.merge, g.end, -bow), gradient: "trunk", width: 1 },
    { d: bowed(g.merge, g.end, bow), gradient: "trunk", width: 1 },
  ];
}

function Particle({ name, glow, size = 1 }: { name: string; glow: string; size?: number }) {
  return (
    <g data-particle={name} style={{ opacity: 0, transition: "opacity 300ms" }}>
      <circle r={11 * size} fill="var(--beam-halo)" filter={`url(#${glow})`} />
      <circle r={3.4 * size} fill="var(--beam-core)" />
    </g>
  );
}

/**
 * The five steps as a pipeline: a particle leaves Hunter (the people) and one leaves Gmail (your
 * inbox); they meet and become one, which runs down through each step as you scroll, lighting
 * the path behind it.
 */
export default function HowItWorks({ theme }: { theme?: BeamTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const id = useId().replace(/:/g, "");
  const dark = theme === "dark";

  useMeasure(ref, () => {
    const el = ref.current;
    // Paths leave from just below each source's label, so they never cross the text.
    const hunter = el?.querySelector('[data-source-block="hunter"]');
    const gmail = el?.querySelector('[data-source-block="gmail"]');
    const dots = el ? [...el.querySelectorAll("[data-beam-dot]")] : [];
    if (!el || !hunter || !gmail || dots.length === 0) return;
    const at = (box: ReturnType<typeof boxIn>, y: number): Pt => ({ x: box.left + box.width / 2, y });
    const centres = dots.map((d) => boxIn(d, el)).map((b) => at(b, b.top + b.height / 2));
    const h = boxIn(hunter, el);
    const g = boxIn(gmail, el);
    setGeo({
      w: el.clientWidth,
      h: el.clientHeight,
      hunter: at(h, h.bottom + 10),
      gmail: at(g, g.bottom + 10),
      merge: centres[0],
      end: centres[centres.length - 1],
      dots: centres.map((c) => c.y),
    });
  });

  const frame = useCallback(
    (y: number) => {
      const el = ref.current;
      if (!el || !geo) return;
      el.querySelectorAll<SVGPathElement>("[data-lit-path]").forEach((p) => {
        if (typeof p.getTotalLength !== "function") return;
        const total = p.getTotalLength();
        lightUp(p, total, lengthAtY(p, total, y));
      });
      // The two source particles ride their curves until they meet...
      for (const name of ["hunter", "gmail"] as const) {
        const path = el.querySelector<SVGPathElement>(`[data-main="${name}"]`);
        const dot = el.querySelector<SVGGElement>(`[data-particle="${name}"]`);
        if (!path || !dot || typeof path.getTotalLength !== "function") continue;
        const total = path.getTotalLength();
        const pt = path.getPointAtLength(lengthAtY(path, total, y));
        dot.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
        dot.style.opacity = y > geo[name].y - 60 && y < geo.merge.y ? "1" : "0";
      }
      // ...then one particle carries on down through the steps.
      const merged = el.querySelector<SVGGElement>('[data-particle="trunk"]');
      if (merged) {
        merged.setAttribute("transform", `translate(${geo.merge.x} ${clamp(y, geo.merge.y, geo.end.y)})`);
        merged.style.opacity = y >= geo.merge.y && y <= geo.end.y + 40 ? "1" : "0";
      }
      el.querySelectorAll("[data-beam-step]").forEach((step, i) => step.toggleAttribute("data-lit", y >= geo.dots[i] - 4));
      el.querySelectorAll("[data-source]").forEach((s) => s.toggleAttribute("data-lit", y > geo.hunter.y - 60));
    },
    [geo],
  );
  useReadingLine(ref, frame, [frame]);

  const source = (name: "hunter" | "gmail", label: string, note: string) => (
    <div data-source-block={name} className="flex flex-col items-center text-center">
      <span
        data-source={name}
        className={`grid size-20 place-items-center rounded-3xl border shadow-sm transition-all duration-500 data-lit:shadow-[0_18px_40px_-14px_rgba(217,4,41,0.45)] sm:size-24 ${
          dark ? "border-white/10 bg-white/5" : "border-cloud bg-paper"
        }`}
      >
        {name === "hunter" ? (
          <Image src="/hunter-logo.png" alt="" width={56} height={56} className="size-11 sm:size-14" />
        ) : (
          <Image src="/gmail-con.png" alt="" width={64} height={48} className="h-9 w-auto sm:h-11" />
        )}
      </span>
      <p className={`mt-3 text-sm font-semibold ${dark ? "text-white" : "text-ink"}`}>{label}</p>
      <p className={`text-xs ${dark ? "text-white/50" : "text-steel"}`}>{note}</p>
    </div>
  );

  return (
    <div ref={ref} className="relative" style={theme ? BEAM_THEMES[theme] : undefined}>
      {geo && (
        <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={geo.w} height={geo.h}>
          <defs>
            <linearGradient id={`${id}-hunter`} gradientUnits="userSpaceOnUse" x1={geo.hunter.x} y1={geo.hunter.y} x2={geo.merge.x} y2={geo.merge.y}>
              <stop offset="0" stopColor="#ff9a5c" />
              <stop offset="1" stopColor="#d90429" />
            </linearGradient>
            <linearGradient id={`${id}-gmail`} gradientUnits="userSpaceOnUse" x1={geo.gmail.x} y1={geo.gmail.y} x2={geo.merge.x} y2={geo.merge.y}>
              <stop offset="0" stopColor="#4285f4" />
              <stop offset="0.55" stopColor="#ea4335" />
              <stop offset="1" stopColor="#d90429" />
            </linearGradient>
            <linearGradient id={`${id}-trunk`} gradientUnits="userSpaceOnUse" x1={geo.merge.x} y1={geo.merge.y} x2={geo.end.x} y2={geo.end.y}>
              <stop offset="0" stopColor="#d90429" />
              <stop offset="0.6" stopColor="#ef233c" />
              <stop offset="1" stopColor="#a26bff" />
            </linearGradient>
            <filter id={`${id}-glow`} x="-2" y="-2" width="5" height="5">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {/* Faint tracks, then the same tracks lit up to the particle */}
          {tracks(geo).map((t, i) => (
            <path key={`track-${i}`} d={t.d} fill="none" stroke="var(--beam-track)" strokeWidth={1.25} />
          ))}
          {tracks(geo).map((t, i) => (
            <path
              key={`lit-${i}`}
              data-lit-path
              data-main={t.main}
              d={t.d}
              fill="none"
              stroke={`url(#${id}-${t.gradient})`}
              strokeWidth={t.width}
              strokeLinecap="round"
              style={{ strokeDasharray: 100000, strokeDashoffset: 100000 }}
            />
          ))}
          <Particle name="hunter" glow={`${id}-glow`} />
          <Particle name="gmail" glow={`${id}-glow`} />
          <Particle name="trunk" glow={`${id}-glow`} size={1.3} />
        </svg>
      )}

      {/* The two sources: the people (Hunter) and your inbox (Gmail) */}
      <div className="relative grid grid-cols-2">
        {source("hunter", "Hunter", "the people and their emails")}
        {source("gmail", "Gmail", "your own inbox")}
      </div>

      <div className="h-40 sm:h-56" />

      <ol className="relative space-y-16 sm:space-y-20">
        {STEPS.map(({ icon: Icon, title, text, example }, i) => {
          const last = i === STEPS.length - 1;
          const left = i % 2 === 0; // on wide screens, steps alternate sides of the line
          return (
            <li key={title} data-beam-step className="group grid grid-cols-[3.5rem_1fr] items-center gap-5 lg:grid-cols-[1fr_5rem_1fr] lg:gap-10">
              <span
                data-beam-dot
                className={`relative z-10 grid size-14 place-items-center rounded-full border text-xl font-bold transition-all duration-500 lg:col-start-2 lg:row-start-1 lg:mx-auto lg:size-16 ${
                  dark ? "border-white/15 bg-night text-white/40" : "border-cloud bg-paper text-steel/60"
                } group-data-lit:border-crimson/30 group-data-lit:text-crimson group-data-lit:shadow-[0_14px_35px_-10px_rgba(217,4,41,0.55)] ${
                  last ? "ring-4 ring-transparent group-data-lit:ring-[#a26bff]/25" : ""
                }`}
              >
                {i + 1}
                <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-night text-white ring-[3px] ring-paper">
                  <Icon className="size-3.5" />
                </span>
              </span>
              <div
                className={`translate-y-2 opacity-40 transition-all duration-700 group-data-lit:translate-y-0 group-data-lit:opacity-100 lg:row-start-1 ${
                  left ? "lg:col-start-1 lg:text-right" : "lg:col-start-3"
                }`}
              >
                <h3 className={`text-xl font-semibold tracking-tight lg:text-2xl ${dark ? "text-white" : "text-ink"}`}>{title}</h3>
                <p className={`mt-2 text-base leading-relaxed text-pretty ${dark ? "text-white/60" : "text-steel"}`}>{text}</p>
                <span
                  className={`mt-3 inline-block rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap lg:text-sm ${
                    dark ? "bg-white/10 text-white/80" : "bg-paper text-ink/80"
                  }`}
                >
                  {example}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
