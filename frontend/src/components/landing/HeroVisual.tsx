import Image from "next/image";
import { CalendarCheck, Check } from "lucide-react";

/** The three moments of an outreach, as example emails (made-up names). Positions are shares
 * of the canvas, taken from the design: each card a little further right. */
const EMAILS = [
  { to: "Alex", line: "Just wanted to reach out…", badge: "Sent", icon: Check, tone: "bg-emerald-500/15 text-emerald-400 ring-emerald-400/25", at: { left: "48%", top: "0%" } },
  { to: "Priya", line: "Great chatting earlier…", badge: "Replied", icon: null, tone: "bg-sky-500/15 text-sky-300 ring-sky-400/25", at: { left: "50.5%", top: "18.5%" } },
  { to: "Daniel", line: "Let’s hop on a call…", badge: "Booked", icon: CalendarCheck, tone: "bg-violet-500/20 text-violet-300 ring-violet-400/30", at: { left: "53%", top: "37%" } },
];

/**
 * The hero's right side: one big popsicle, the three emails it turns into (sent, replied,
 * booked), dashed arrows looping between them, and the envelope. Laid out on a fixed-ratio
 * canvas (7:5) so the arrows (SVG, 1000×714) always meet the cards and the popsicle.
 */
export default function HeroVisual() {
  return (
    <div aria-hidden className="relative mx-auto aspect-[7/5] w-full max-w-[760px] select-none">
      {/* A soft light behind the popsicle */}
      <div className="absolute top-[22%] left-[8%] aspect-square w-[44%] rounded-full bg-[#3d5afe]/20 blur-3xl" />

      {/* Dashed arrows: popsicle → first email, around the popsicle, last email → popsicle */}
      <svg viewBox="0 0 1000 714" className="animate-fade-in absolute inset-0 h-full w-full overflow-visible" style={{ animationDelay: "900ms" }}>
        <defs>
          <marker id="hero-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 8 5 L 0 9" fill="none" stroke="#7c86d8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <g fill="none" stroke="#7c86d8" strokeOpacity="0.75" strokeWidth="3" strokeDasharray="9 10" strokeLinecap="round">
          <path d="M 380 175 C 405 120, 440 92, 488 86" markerEnd="url(#hero-arrow)" />
          <path d="M 245 525 C 120 530, 15 470, 28 395 C 38 345, 78 318, 120 312" markerEnd="url(#hero-arrow)" />
          <path d="M 640 405 C 625 450, 585 478, 520 490" markerEnd="url(#hero-arrow)" />
        </g>
      </svg>

      {/* The popsicle */}
      <div
        className="animate-pop-in absolute top-[4%] left-[-4%] w-[68%]"
        style={{ "--r": "-24deg", animationDelay: "250ms" } as React.CSSProperties}
      >
        <Image src="/left-pop.png" alt="" width={500} height={500} priority className="h-auto w-full" />
      </div>

      {/* The three emails */}
      {EMAILS.map(({ to, line, badge, icon: Icon, tone, at }, i) => (
        <div key={to} className="absolute w-[48%]" style={at}>
          <div
            data-hero-email
            className="animate-fade-in flex -rotate-2 items-center gap-2 rounded-2xl border border-ink/10 bg-paper/75 p-2 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur-md sm:p-2.5 xl:gap-3 xl:p-3.5"
            style={{ animationDelay: `${500 + i * 180}ms` }}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white shadow-sm sm:size-8 xl:size-10 xl:rounded-xl">
              <Image src="/gmail-con.png" alt="" width={40} height={30} className="h-3 w-auto sm:h-3.5 xl:h-[18px]" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span data-name className="block text-[10px] font-medium whitespace-nowrap text-ink sm:text-xs xl:text-sm">Hi {to},</span>
              {/* The preview line only shows where the cards are wide enough for it */}
              <span className="hidden truncate text-xs text-ink/60 xl:block">{line}</span>
            </span>
            <span data-badge className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 sm:px-2 sm:text-[11px] xl:px-2.5 xl:py-1 xl:text-xs ${tone}`}>
              {badge}
              {Icon && <Icon className="size-2.5 sm:size-3 xl:size-3.5" />}
            </span>
          </div>
        </div>
      ))}

      {/* The envelope, with a little burst */}
      <div className="animate-pop-in absolute top-[73%] left-[61%] w-[17%]" style={{ "--r": "-10deg", animationDelay: "1100ms" } as React.CSSProperties}>
        <Image src="/cold-emailer-logo.png" alt="" width={527} height={474} className="h-auto w-full" />
        <svg viewBox="0 0 60 60" className="absolute -top-[38%] -right-[28%] w-[45%]" fill="none" stroke="#c9cee0" strokeWidth="4" strokeLinecap="round">
          <path d="M 18 30 L 24 12" />
          <path d="M 30 36 L 46 26" />
          <path d="M 30 50 L 48 50" />
        </svg>
      </div>
    </div>
  );
}
