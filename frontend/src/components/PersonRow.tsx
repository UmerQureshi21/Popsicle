"use client";

import { ExternalLink } from "lucide-react";
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

/** One person found on Hunter, as a selectable row. */
export default function PersonRow({
  person: p,
  selected,
  onToggle,
}: {
  person: FoundPerson;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-cloud/50 ${
        selected ? "bg-crimson/[0.03]" : ""
      }`}
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
            <span className="shrink-0 rounded-full bg-cloud px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-steel">
              emailed {formatDate(p.already_emailed_at)}
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
