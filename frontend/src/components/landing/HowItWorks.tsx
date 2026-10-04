import { Building2, PenLine, Send, UserSearch } from "lucide-react";
import Reveal from "./Reveal";

const STEPS = [
  {
    icon: Building2,
    title: "Pick your companies",
    text: "Type a company name and pick it from the suggestions, so you always get the right one.",
    example: "Meta → meta.com",
  },
  {
    icon: UserSearch,
    title: "Find the right people",
    text: "Filter by job title and location, then tick the people you want to reach.",
    example: "software engineer · in the GTA",
  },
  {
    icon: PenLine,
    title: "Write one email",
    text: "Drop in variables where each person’s details go, and save it as a template for next time.",
    example: "Hi {{first_name}},",
  },
  {
    icon: Send,
    title: "Review and send",
    text: "Check every personalized email, then send from your Gmail, spaced out and never to anyone twice.",
    example: "10 of 10 sent",
  },
];

/** The four steps from "which company?" to "sent", as a numbered timeline. */
export default function HowItWorks() {
  return (
    <ol className="relative grid gap-8 lg:grid-cols-4 lg:gap-6">
      {/* The line joining the steps: horizontal on desktop */}
      <div
        aria-hidden
        className="absolute top-6 right-[12.5%] left-[12.5%] hidden h-px bg-gradient-to-r from-crimson/10 via-crimson/40 to-crimson/10 lg:block"
      />
      {STEPS.map(({ icon: Icon, title, text, example }, i) => (
        <Reveal
          as="li"
          key={title}
          delay={i * 140}
          className="relative flex gap-5 lg:flex-col lg:items-center lg:text-center"
        >
          {/* ...and vertical on phones */}
          {i < STEPS.length - 1 && (
            <div aria-hidden className="absolute top-14 bottom-[-2rem] left-6 w-px bg-crimson/20 lg:hidden" />
          )}
          <div className="relative shrink-0 self-start lg:self-center">
            <span className="grid size-12 place-items-center rounded-full border border-cloud bg-white text-lg font-bold text-crimson shadow-[0_10px_25px_-10px_rgba(217,4,41,0.45)]">
              {i + 1}
            </span>
            <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-ink text-white ring-2 ring-white">
              <Icon className="size-3.5" />
            </span>
          </div>
          <div className="min-w-0 lg:mt-5">
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
            <p className="mt-1.5 leading-relaxed text-pretty text-steel">{text}</p>
            <span className="mt-3 inline-block rounded-lg bg-cloud px-2.5 py-1 text-xs font-medium text-ink/80">
              {example}
            </span>
          </div>
        </Reveal>
      ))}
    </ol>
  );
}
