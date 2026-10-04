"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Tag } from "lucide-react";
import { api, type PeopleCount } from "@/lib/api";
import { Button } from "@/components/ui";

const DEPARTMENT_LABELS: Record<string, string> = { it: "Engineering/IT", hr: "HR/Recruiting" };

type Props = {
  /** Domain if known, otherwise the company name that was searched. */
  company: string;
  organization: string | null;
  /** What the search was filtered by, e.g. matching “software engineer” in the GTA. */
  filterLabel: string;
  onAnywhere?: () => void;
  onWithoutTitle?: () => void;
  retryCost: string;
};

/**
 * Shown when a company search finds no one. Looks up (for free) how many people Hunter has at the
 * company overall, so it's clear whether the filters or the company are the problem, and offers
 * one-click retries with looser filters.
 */
export default function EmptyResultHelp({ company, organization, filterLabel, onAnywhere, onWithoutTitle, retryCost }: Props) {
  const [count, setCount] = useState<PeopleCount | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<PeopleCount>(`/api/people-search/count?query=${encodeURIComponent(company)}`).then(setCount, () => setFailed(true));
  }, [company]);

  const name = organization || company;

  if (!count && !failed) {
    return (
      <p className="flex items-center gap-2 px-5 py-8 text-sm text-steel">
        <Loader2 className="size-4 animate-spin" /> No one matched. Checking how many people Hunter has at {name}…
      </p>
    );
  }

  if (failed || !count || count.total === 0) {
    return (
      <p className="px-5 py-8 text-sm text-steel">
        Hunter has no people for {name} yet. Try picking the company from the suggestions as you type, or use its
        website domain (like <span className="text-ink">harvey.ai</span>).
      </p>
    );
  }

  const top = Object.entries(count.by_department)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d, n]) => `${n} in ${DEPARTMENT_LABELS[d] ?? d.charAt(0).toUpperCase() + d.slice(1)}`);

  return (
    <div className="space-y-4 px-5 py-6">
      <p className="text-sm leading-relaxed text-ink/85">
        Hunter has <span className="font-semibold text-ink">{count.total.toLocaleString()} people</span> at {name}
        {top.length > 0 && <span className="text-steel"> ({top.join(", ")})</span>}, but none {filterLabel || "for this search"}.
        The filters are leaving everyone out.
      </p>
      {(onAnywhere || onWithoutTitle) && (
        <div className="flex flex-wrap items-center gap-2">
          {onAnywhere && (
            <Button onClick={onAnywhere}>
              <MapPin className="size-4" /> Search anywhere
            </Button>
          )}
          {onWithoutTitle && (
            <Button onClick={onWithoutTitle}>
              <Tag className="size-4" /> Remove the job title
            </Button>
          )}
          <span className="text-xs text-steel">{retryCost}, free if still no one</span>
        </div>
      )}
    </div>
  );
}
