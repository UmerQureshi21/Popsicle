"use client";

import { ExternalLink, TriangleAlert } from "lucide-react";
import type { FoundPerson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/ui";

export function ConfidencePill({ value }: { value: number | null }) {
  if (value == null) return null;
  const style =
    value >= 90 ? "bg-emerald-50 text-emerald-700" : value >= 70 ? "bg-cloud text-ink" : "bg-crimson/10 text-crimson";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${style}`} title="Hunter's confidence that this email is right">
      {value}%
    </span>
  );
}

/**
 * One person found on Hunter, as a selectable row. People you've already emailed are flagged in
 * red (tinted background, red edge, "Already emailed" badge) as an early warning before you
 * email them again. Red is reserved for that warning; a ticked row is tinted grey.
 */
export default function PersonRow({
  person: p,
  selected,
  onToggle,
}: {
  person: FoundPerson;
  selected: boolean;
  onToggle: () => void;
}) {
  const emailed = !!p.already_emailed_at;
  const tone = emailed
    ? "bg-crimson/[0.07] shadow-[inset_4px_0_0_var(--color-crimson)] hover:bg-crimson/10"
    : selected
      ? "bg-cloud/60 hover:bg-cloud"
      : "hover:bg-cloud/50";
  return (
    <label
      data-already-emailed={emailed || undefined}
      className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${tone}`}
    >
      <input type="checkbox" className="size-4 accent-crimson" checked={selected} onChange={onToggle} />
      <Avatar name={p.full_name || p.email} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{p.full_name || p.email}</span>
          {p.linkedin_url && (
            <a
              href={p.linkedin_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-steel hover:text-ink"
              aria-label="LinkedIn profile"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
          {p.already_emailed_at && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-crimson px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white"
              title="You've emailed this person before"
            >
              <TriangleAlert className="size-3" aria-hidden />
              Already emailed · {formatDate(p.already_emailed_at)}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-steel">
          {[p.position, p.seniority && `${p.seniority} level`].filter(Boolean).join(" · ") || "No title listed"}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-ink sm:hidden">
          <span className="truncate">{p.email}</span>
          <ConfidencePill value={p.confidence} />
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-2 text-sm text-ink sm:flex">
        {p.email}
        <ConfidencePill value={p.confidence} />
      </span>
    </label>
  );
}
