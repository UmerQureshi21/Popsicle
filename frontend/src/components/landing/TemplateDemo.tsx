"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui";

const PEOPLE = [
  { first_name: "Jane", full_name: "Jane Doe", company: "Stripe", team: "Payments" },
  { first_name: "Sean", full_name: "Sean O'Brien", company: "Figma", team: "Multiplayer" },
  { first_name: "Priya", full_name: "Priya Patel", company: "Notion", team: "AI" },
  { first_name: "Marcus", full_name: "Marcus Lee", company: "Linear", team: "Sync" },
];

const Chip = ({ children }: { children: string }) => <span className="placeholder-chip">{`{{${children}}}`}</span>;

/** One template on the left, the email each person actually receives on the right. */
export default function TemplateDemo() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % PEOPLE.length), 2800);
    return () => clearInterval(t);
  }, []);

  const p = PEOPLE[i];

  return (
    <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
      <div className="rounded-3xl border border-cloud bg-white p-7 text-left shadow-[0_30px_60px_-30px_rgba(43,45,66,0.35)]">
        <p className="mb-5 text-xs font-semibold tracking-widest text-steel uppercase">Your template</p>
        <p className="mb-4 text-lg font-semibold text-ink">
          Quick question about <Chip>company</Chip>
        </p>
        <div className="space-y-3 text-[15px] leading-7 text-ink/85">
          <p>
            Hi <Chip>first_name</Chip>,
          </p>
          <p>
            I’ve been following what <Chip>company</Chip> is building, and the work the <Chip>team</Chip> team is doing
            really stood out.
          </p>
          <p>Would you be open to a quick chat next week?</p>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <span className="grid size-12 rotate-90 place-items-center rounded-full bg-ink text-white shadow-lg md:rotate-0">
          <ArrowRight className="size-5" />
        </span>
      </div>

      <div className="relative rounded-3xl border border-cloud bg-white p-7 text-left shadow-[0_30px_60px_-30px_rgba(43,45,66,0.35)]">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest text-steel uppercase">What they get</p>
          <div className="flex gap-1.5">
            {PEOPLE.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-all duration-500 ${n === i ? "w-5 bg-crimson" : "w-1.5 bg-cloud"}`} />
            ))}
          </div>
        </div>
        <div key={i} className="animate-fade-in">
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={p.full_name} size={32} />
            <div>
              <p className="text-sm font-semibold text-ink">{p.full_name}</p>
              <p className="text-xs text-steel">
                {p.first_name.toLowerCase()}@{p.company.toLowerCase()}.com
              </p>
            </div>
          </div>
          <p className="mb-4 text-lg font-semibold text-ink">Quick question about {p.company}</p>
          <div className="space-y-3 text-[15px] leading-7 text-ink/85">
            <p>Hi {p.first_name},</p>
            <p>
              I’ve been following what {p.company} is building, and the work the {p.team} team is doing really stood out.
            </p>
            <p>Would you be open to a quick chat next week?</p>
          </div>
        </div>
      </div>
    </div>
  );
}
