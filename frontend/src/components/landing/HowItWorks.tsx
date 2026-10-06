import { Inbox, PenLine, Send, UserSearch, Video } from "lucide-react";
import Reveal from "./Reveal";

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

/** The five steps from "which company?" to a call on the calendar, as a numbered timeline. */
export default function HowItWorks() {
  return (
    <ol className="relative grid gap-12 lg:grid-cols-5 lg:gap-8">
      {/* The line joining the steps: horizontal on desktop */}
      <div
        aria-hidden
        className="absolute top-10 right-[10%] left-[10%] hidden h-0.5 bg-gradient-to-r from-crimson/10 via-crimson/40 to-crimson/10 lg:block"
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
            <h3 className="text-xl font-semibold tracking-tight text-balance text-ink">{title}</h3>
            <p className="mt-2.5 text-base leading-relaxed text-pretty text-steel">{text}</p>
            <span className="mt-4 inline-block rounded-xl bg-white px-3 py-1.5 text-xs font-medium whitespace-nowrap text-ink/80 lg:px-3.5 lg:text-sm">
              {example}
            </span>
          </div>
        </Reveal>
      ))}
    </ol>
  );
}
