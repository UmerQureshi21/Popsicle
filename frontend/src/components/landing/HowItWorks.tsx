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
    <ol className="relative grid gap-12 lg:grid-cols-4 lg:gap-10">
      {/* The line joining the steps: horizontal on desktop */}
      <div
        aria-hidden
        className="absolute top-10 right-[12.5%] left-[12.5%] hidden h-0.5 bg-gradient-to-r from-crimson/10 via-crimson/40 to-crimson/10 lg:block"
      />
      {STEPS.map(({ icon: Icon, title, text, example }, i) => (
        <Reveal
          as="li"
          key={title}
          delay={i * 140}
          className="relative flex gap-6 lg:flex-col lg:items-center lg:text-center"
        >
          {/* ...and vertical on phones */}
          {i < STEPS.length - 1 && (
            <div aria-hidden className="absolute top-[4.5rem] bottom-[-3rem] left-7 w-0.5 bg-crimson/20 lg:hidden" />
          )}
          <div className="relative shrink-0 self-start lg:self-center">
            <span className="grid size-14 place-items-center rounded-full border border-cloud bg-white text-2xl font-bold lg:size-20 lg:text-3xl text-crimson shadow-[0_14px_35px_-12px_rgba(217,4,41,0.5)]">
              {i + 1}
            </span>
            <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-ink text-white ring-[3px] ring-white lg:size-9">
              <Icon className="size-3.5 lg:size-[18px]" />
            </span>
          </div>
          <div className="min-w-0 pt-1 lg:mt-7 lg:pt-0">
            <h3 className="text-xl font-semibold tracking-tight text-ink lg:text-2xl">{title}</h3>
            <p className="mt-2.5 text-base leading-relaxed text-pretty text-steel lg:text-lg">{text}</p>
            <span className="mt-4 inline-block rounded-xl bg-cloud px-3 py-1.5 text-xs font-medium whitespace-nowrap text-ink/80 lg:px-3.5 lg:text-sm">
              {example}
            </span>
          </div>
        </Reveal>
      ))}
    </ol>
  );
}
