"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Search, UserPlus } from "lucide-react";
import { api, type EmailFinderResult, type FoundPerson, type PeopleSearch } from "@/lib/api";
import { creditsChanged, creditsText, searchCost, useHunterStatus } from "@/lib/credits";
import { formatDate } from "@/lib/format";
import { DEFAULT_LOCATION, LOCATIONS, locationById, type LocationId } from "@/lib/locations";
import { Button, Modal } from "@/components/ui";
import CompanyAutocomplete from "@/components/CompanyAutocomplete";
import EmptyResultHelp from "@/components/EmptyResultHelp";
import PersonRow, { EmailedCount } from "@/components/PersonRow";
import Select from "@/components/Select";

// Hunter's department and seniority filters (https://hunter.io/api-documentation/v2#domain-search).
const DEPARTMENTS: [string, string][] = [
  ["", "Any department"],
  ["it", "Engineering / IT"],
  ["product", "Product"],
  ["design", "Design"],
  ["hr", "HR / Recruiting"],
  ["executive", "Executive"],
  ["management", "Management"],
  ["sales", "Sales"],
  ["marketing", "Marketing"],
  ["operations", "Operations"],
  ["finance", "Finance"],
  ["research", "Research"],
  ["support", "Support"],
];
const SENIORITIES: [string, string][] = [
  ["", "Any seniority"],
  ["junior", "Junior"],
  ["senior", "Senior"],
  ["executive", "Executive"],
];
const PAGE_SIZES = [5, 10, 25, 50];

type Props = {
  initialQuery: string;
  onClose: () => void;
  onAdd: (people: FoundPerson[], organization: string | null) => void;
};

export default function FindPeopleModal({ initialQuery, onClose, onAdd }: Props) {
  const status = useHunterStatus();
  const [query, setQuery] = useState(initialQuery);
  const [department, setDepartment] = useState("");
  const [seniority, setSeniority] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState<LocationId>(DEFAULT_LOCATION);
  const [limit, setLimit] = useState(10);

  const [result, setResult] = useState<PeopleSearch | null>(null);
  const [people, setPeople] = useState<FoundPerson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<"search" | "more" | "person" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupName, setLookupName] = useState("");
  const [lookupUrl, setLookupUrl] = useState("");
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);


  // New people are pre-selected unless they've already been emailed.
  const addResults = (found: FoundPerson[], replace: boolean) => {
    const base = replace ? [] : people;
    const known = new Set(base.map((p) => p.email));
    const fresh = found.filter((p) => !known.has(p.email));
    setPeople([...base, ...fresh]);
    setSelected((prev) => {
      const next = new Set(replace ? [] : prev);
      fresh.forEach((p) => !p.already_emailed_at && next.add(p.email));
      return next;
    });
  };

  const search = async (
    more = false,
    refresh = false,
    q = query,
    // Retries from the "no one found" panel loosen a filter for this search and in the form.
    loosen: { location?: LocationId; jobTitle?: string } = {},
  ) => {
    if (!q.trim()) return;
    const loc = loosen.location ?? location;
    const title = loosen.jobTitle ?? jobTitle;
    if (loosen.location) setLocation(loosen.location);
    if (loosen.jobTitle !== undefined) setJobTitle(loosen.jobTitle);
    setLoading(more ? "more" : "search");
    setError(null);
    try {
      const res = await api.post<PeopleSearch>("/api/people-search/company", {
        query: q.trim(),
        limit,
        offset: more && result ? result.offset + result.limit : 0,
        department: department || null,
        seniority: seniority || null,
        job_titles: title.trim() || null,
        location: locationById(loc).filters,
        refresh,
      });
      setResult(res);
      addResults(res.people, !more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
      creditsChanged();
    }
  };

  const lookup = async () => {
    const company = result?.domain || query.trim();
    if (!company || (!lookupName.trim() && !lookupUrl.trim())) return;
    setLoading("person");
    setLookupMessage(null);
    try {
      const res = await api.post<EmailFinderResult>("/api/people-search/person", {
        company,
        full_name: lookupName.trim() || null,
        linkedin_url: lookupUrl.trim() || null,
      });
      if (res.person) {
        addResults([res.person], false);
        setSelected((prev) => new Set(prev).add(res.person!.email));
        setLookupMessage(`Found ${res.person.email}`);
        setLookupName("");
        setLookupUrl("");
      } else {
        setLookupMessage(`Hunter couldn’t find an email for them at ${company}. No credit was used.`);
      }
    } catch (e) {
      setLookupMessage((e as Error).message);
    } finally {
      setLoading(null);
      creditsChanged();
    }
  };

  const toggle = (email: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  const allSelected = people.length > 0 && people.every((p) => selected.has(p.email));
  const chosen = useMemo(() => people.filter((p) => selected.has(p.email)), [people, selected]);
  const hasMore = !!result && result.offset + result.limit < result.total;

  const credits =
    status?.configured && status.credits_remaining != null ? (
      <span className="text-xs text-steel">
        <span className="font-semibold text-ink">{status.credits_remaining}</span> Hunter credits left
        {status.reset_date && <> · resets {formatDate(status.reset_date)}</>}
      </span>
    ) : null;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          Find people
          <span className="hidden sm:inline">{credits}</span>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-steel">
            {chosen.length} selected
            {chosen.some((p) => p.already_emailed_at) && (
              <span className="text-crimson"> · includes people you’ve already emailed</span>
            )}
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!chosen.length}
              onClick={() => {
                onAdd(chosen, result?.organization ?? null);
                onClose();
              }}
            >
              <UserPlus className="size-4" /> Add {chosen.length || ""} to recipients
            </Button>
          </div>
        </div>
      }
    >
      {status && !status.configured ? (
        <div className="p-8 text-sm leading-relaxed text-ink">
          <p className="font-semibold">Hunter isn’t set up yet.</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink/80">
            <li>
              Copy your API key from{" "}
              <a href="https://hunter.io/api-keys" target="_blank" rel="noreferrer" className="font-medium text-crimson underline">
                hunter.io/api-keys
              </a>
              .
            </li>
            <li>
              Add <code className="rounded bg-cloud px-1.5 py-0.5">HUNTER_API_KEY=your-key</code> to <code className="rounded bg-cloud px-1.5 py-0.5">backend/.env</code>.
            </li>
            <li>Restart the backend (stop and re-run ./dev.sh).</li>
          </ol>
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          {status?.error && <p className="mb-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson">{status.error}</p>}

          {/* Search */}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <CompanyAutocomplete
              autoFocus
              ariaLabel="Company"
              value={query}
              onChange={setQuery}
              onPick={(sug) => {
                // A picked suggestion is an exact domain, so search it straight away.
                setQuery(sug.domain);
                search(false, false, sug.domain);
              }}
              placeholder="Company name or domain, e.g. Harvey"
              leading={<Search className="size-4 shrink-0 text-steel" />}
              className="min-w-60 flex-1 rounded-xl border border-steel/30 bg-paper px-3 focus-within:border-scarlet focus-within:ring-4 focus-within:ring-scarlet/10"
            />
            <input
              aria-label="Job title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Job title, e.g. software engineer"
              className="w-full rounded-xl border border-steel/30 bg-paper px-3 py-2.5 text-sm outline-none placeholder:text-steel focus:border-scarlet sm:w-56"
            />
            <Select
              ariaLabel="Location"
              value={location}
              onChange={setLocation}
              options={LOCATIONS.map((l) => ({ value: l.id, label: l.label }))}
            />
            {(
              [
                [department, setDepartment, DEPARTMENTS, "Department"],
                [seniority, setSeniority, SENIORITIES, "Seniority"],
              ] as const
            ).map(([value, setValue, options, label]) => (
              <Select
                key={label}
                ariaLabel={label}
                value={value}
                onChange={setValue}
                options={options.map(([v, l]) => ({ value: v, label: l }))}
              />
            ))}
            <Select
              ariaLabel="How many people"
              value={limit}
              onChange={setLimit}
              options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} people`, hint: creditsText(searchCost(n)) }))}
            />
            <Button type="submit" variant="primary" disabled={!query.trim() || !!loading}>
              {loading === "search" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Search
            </Button>
          </form>
          <p className="mt-2 text-xs text-steel">
            Uses up to {creditsText(searchCost(limit))} (1 per 10 people found). Free if no one is found or you’ve searched it before.
          </p>

          {error && <p className="mt-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson">{error}</p>}

          {/* Results */}
          {result && (
            <div className="mt-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2.5 font-medium text-ink">
                  <input
                    type="checkbox"
                    className="size-4 accent-crimson"
                    checked={allSelected}
                    disabled={!people.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(people.map((p) => p.email)))}
                  />
                  {result.organization ?? query}
                  {result.domain && <span className="font-normal text-steel">· {result.domain}</span>}
                </label>
                <span className="flex items-center gap-2 text-xs text-steel">
                  {result.cached && (
                    <button
                      className="rounded-full bg-cloud px-2 py-0.5 hover:bg-steel/20"
                      title="These results were saved earlier, so no credits were used. Click to search Hunter again."
                      onClick={() => search(false, true)}
                    >
                      saved results · refresh
                    </button>
                  )}
                  showing {people.length} of {result.total}
                  <EmailedCount people={people} />
                </span>
              </div>

              {people.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-steel/40">
                  <EmptyResultHelp
                    company={result.domain ?? query.trim()}
                    organization={result.organization}
                    filterLabel={[
                      jobTitle.trim() && `matching “${jobTitle.trim()}”`,
                      department && `in ${DEPARTMENTS.find(([v]) => v === department)?.[1]}`,
                      seniority && `at ${seniority} level`,
                      locationById(location).short,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    retryCost={`Up to ${creditsText(searchCost(limit))}`}
                    onAnywhere={location !== "any" ? () => search(false, false, query, { location: "any" }) : undefined}
                    onWithoutTitle={jobTitle.trim() ? () => search(false, false, query, { jobTitle: "" }) : undefined}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-cloud rounded-2xl border border-cloud">
                  {people.map((p) => (
                    <li key={p.email}>
                      <PersonRow person={p} selected={selected.has(p.email)} onToggle={() => toggle(p.email)} />
                    </li>
                  ))}
                </ul>
              )}

              {hasMore && (
                <div className="mt-3 text-center">
                  <Button variant="ghost" disabled={!!loading} onClick={() => search(true)}>
                    {loading === "more" && <Loader2 className="size-4 animate-spin" />}
                    Load {Math.min(limit, result.total - result.offset - result.limit)} more (up to {creditsText(searchCost(limit))})
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Single lookup */}
          <div className="mt-6 rounded-2xl bg-cloud/70">
            <button
              onClick={() => setLookupOpen(!lookupOpen)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-medium text-ink"
            >
              Can’t find someone? Look them up by name or LinkedIn URL
              <ChevronDown className={`size-4 text-steel transition-transform ${lookupOpen ? "rotate-180" : ""}`} />
            </button>
            {lookupOpen && (
              <form
                className="space-y-3 px-5 pb-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  lookup();
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={lookupName}
                    onChange={(e) => setLookupName(e.target.value)}
                    placeholder="Full name, e.g. Jane Doe"
                    className="rounded-xl border border-steel/30 bg-paper px-3 py-2.5 text-sm outline-none focus:border-scarlet"
                  />
                  <input
                    value={lookupUrl}
                    onChange={(e) => setLookupUrl(e.target.value)}
                    placeholder="or linkedin.com/in/…"
                    className="rounded-xl border border-steel/30 bg-paper px-3 py-2.5 text-sm outline-none focus:border-scarlet"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-steel">
                    At {result?.domain || query.trim() || "the company above"} · 1 credit if found, free if not
                  </span>
                  <Button type="submit" disabled={!!loading || !(result?.domain || query.trim()) || !(lookupName.trim() || lookupUrl.trim())}>
                    {loading === "person" && <Loader2 className="size-4 animate-spin" />}
                    Find email
                  </Button>
                </div>
                {lookupMessage && <p className="text-sm text-ink/80">{lookupMessage}</p>}
              </form>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
