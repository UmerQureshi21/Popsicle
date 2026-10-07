"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Search, Sparkles, UserSearch, X } from "lucide-react";
import { api, type FoundPerson, type NewPeople, type PeopleSearch } from "@/lib/api";
import { creditsChanged, creditsText, searchCost, useHunterStatus } from "@/lib/credits";
import { formatDate } from "@/lib/format";
import { DEFAULT_LOCATION, LOCATIONS, locationById, type LocationId } from "@/lib/locations";
import { textChip, textToChips, type Chip } from "@/lib/chips";
import { saveHandoff } from "@/lib/people";
import { Button, EmptyState } from "@/components/ui";
import CompanyAutocomplete, { CompanyLogo } from "@/components/CompanyAutocomplete";
import EmptyResultHelp from "@/components/EmptyResultHelp";
import { EmailedCount } from "@/components/PersonRow";
import PersonRow from "@/components/PersonRow";
import Select from "@/components/Select";

type CompanyResult = {
  query: string;
  state: "loading" | "done" | "error";
  error?: string;
  search?: PeopleSearch; // the latest page fetched
  people: FoundPerson[];
  selected: string[]; // emails
  filterLabel?: string; // e.g. “software engineer” in the GTA, as searched
  filters?: Filters; // what this company was searched with, reused for load more and refresh
  fresh?: boolean; // showing "new people" (not emailed yet) rather than a page of the search
  note?: string; // what the last "new people" fetch found
};

type Filters = { jobTitle: string; location: LocationId };

type Saved = {
  chips: Chip[];
  jobTitle: string;
  location: LocationId;
  perCompany: number;
  hideSeen: boolean; // "new people" also leaves out anyone shown before
  results: CompanyResult[];
};

const STORAGE_KEY = "popsicle:find-people:v1";
const PER_COMPANY = [5, 10, 25];
const DEFAULTS: Saved = {
  chips: [],
  jobTitle: "software engineer",
  location: DEFAULT_LOCATION,
  perCompany: 10,
  hideSeen: false,
  results: [],
};

/** What a "Get new people" fetch found, in a sentence. */
export function newPeopleNote(res: NewPeople, company: string, hideSeen: boolean): string {
  if (res.people.length === 0) {
    return res.reached_end
      ? `You’ve reached everyone Hunter has at ${company} for this search. Try a wider location, or no job title.`
      : `No new people in the next ${res.pages_checked * 10} results. Click again to keep looking.`;
  }
  const n = res.people.length;
  const who = hideSeen ? "you haven’t seen or emailed" : "you haven’t emailed";
  const cost = res.pages_paid ? `Used about ${creditsText(res.pages_paid)}.` : "Free: from results saved earlier.";
  const last = res.reached_end ? " That’s everyone new Hunter has for this search." : "";
  return `${n} ${n === 1 ? "person" : "people"} ${who}. ${cost}${last}`;
}

/** Start Find people with these companies (e.g. picked on the Companies page), replacing any
 * companies and results from the last search but keeping its filters. */
export function presetCompanies(chips: Chip[]) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), chips, results: [] }));
  } catch {}
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { companiesText, ...rest } = JSON.parse(raw);
      const saved: Saved = { ...DEFAULTS, ...rest };
      // Searches saved before chips stored companies as text, one per line.
      if (!rest.chips && companiesText) saved.chips = textToChips(companiesText);
      // A search interrupted by leaving the page can't finish; show it as failed instead of spinning.
      saved.results = saved.results.map((r) =>
        r.state === "loading" ? { ...r, state: "error", error: "Interrupted. Search again." } : r,
      );
      return saved;
    }
  } catch {}
  return DEFAULTS;
}

export default function FindPeople() {
  const router = useRouter();
  const [initial] = useState(load);
  const [chips, setChips] = useState<Chip[]>(initial.chips);
  const [draftCompany, setDraftCompany] = useState("");
  const [jobTitle, setJobTitle] = useState(initial.jobTitle);
  const [location, setLocation] = useState<LocationId>(initial.location);
  const [perCompany, setPerCompany] = useState(initial.perCompany);
  const [hideSeen, setHideSeen] = useState(initial.hideSeen);
  const [results, setResults] = useState<CompanyResult[]>(initial.results);
  const status = useHunterStatus();
  const [searching, setSearching] = useState(false);


  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chips, jobTitle, location, perCompany, hideSeen, results }));
    } catch {}
  }, [chips, jobTitle, location, perCompany, hideSeen, results]);

  const companies = chips.map((c) => c.query);
  const addChips = (added: Chip[]) => {
    setChips((prev) => {
      const seen = new Set(prev.map((c) => c.query.toLowerCase()));
      return [...prev, ...added.filter((c) => !seen.has(c.query.toLowerCase()) && seen.add(c.query.toLowerCase()))];
    });
    setDraftCompany("");
  };
  const update = (query: string, patch: Partial<CompanyResult> | ((r: CompanyResult) => Partial<CompanyResult>)) =>
    setResults((prev) => prev.map((r) => (r.query === query ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));

  const fetchCompany = async (query: string, offset = 0, refresh = false, filters: Filters = { jobTitle, location }) => {
    update(query, { state: "loading", error: undefined });
    try {
      const res = await api.post<PeopleSearch>("/api/people-search/company", {
        query,
        limit: perCompany,
        offset,
        job_titles: filters.jobTitle.trim() || null,
        location: locationById(filters.location).filters,
        refresh,
      });
      update(query, (r) => {
        const base = offset ? r.people : [];
        const known = new Set(base.map((p) => p.email));
        const fresh = res.people.filter((p) => !known.has(p.email));
        // New people start selected unless they've already been emailed.
        const autoSelect = fresh.filter((p) => !p.already_emailed_at).map((p) => p.email);
        return {
          state: "done",
          search: res,
          fresh: false,
          note: undefined,
          filters,
          filterLabel: [filters.jobTitle.trim() && `matching “${filters.jobTitle.trim()}”`, locationById(filters.location).short]
            .filter(Boolean)
            .join(" "),
          people: [...base, ...fresh],
          selected: offset ? [...r.selected, ...autoSelect] : autoSelect,
        };
      });
    } catch (e) {
      update(query, { state: "error", error: (e as Error).message });
    } finally {
      creditsChanged();
    }
  };

  /** The next people at this company not emailed yet (and, with hideSeen, never shown). */
  const getNew = async (r: CompanyResult) => {
    const filters = r.filters ?? { jobTitle, location };
    update(r.query, { state: "loading", error: undefined });
    try {
      const res = await api.post<NewPeople>("/api/people-search/company/new", {
        query: r.query,
        want: perCompany,
        job_titles: filters.jobTitle.trim() || null,
        location: locationById(filters.location).filters,
        hide_seen: hideSeen,
      });
      update(r.query, (prev) => ({
        state: "done",
        fresh: true,
        filters,
        note: newPeopleNote(res, prev.search?.organization ?? r.query, hideSeen),
        search: {
          domain: res.domain ?? prev.search?.domain ?? null,
          organization: res.organization ?? prev.search?.organization ?? null,
          pattern: res.pattern,
          total: res.total,
          offset: 0,
          limit: res.people.length,
          people: res.people,
          cached: res.pages_paid === 0,
        },
        people: res.people,
        selected: res.people.map((p) => p.email),
      }));
    } catch (e) {
      update(r.query, { state: "error", error: (e as Error).message });
    } finally {
      creditsChanged();
    }
  };

  const searchAll = async () => {
    if (!companies.length) return;
    setSearching(true);
    setResults(companies.map((query) => ({ query, state: "loading", people: [], selected: [] })));
    // One at a time keeps us well inside Hunter's rate limit, and results (and the credit count) update as they arrive.
    for (const query of companies) await fetchCompany(query);
    setSearching(false);
  };

  const toggle = (query: string, email: string) =>
    update(query, (r) => ({
      selected: r.selected.includes(email) ? r.selected.filter((e) => e !== email) : [...r.selected, email],
    }));

  const emailThese = (r: CompanyResult) => {
    saveHandoff({
      company: r.search?.organization ?? r.query,
      people: r.people.filter((p) => r.selected.includes(p.email)),
    });
    router.push("/compose");
  };

  if (status && !status.configured) {
    return (
      <EmptyState icon={<UserSearch className="size-5" />} title="Hunter isn’t set up yet">
        Add <code className="rounded bg-cloud px-1.5 py-0.5 text-ink">HUNTER_API_KEY=your-key</code> to{" "}
        <code className="rounded bg-cloud px-1.5 py-0.5 text-ink">backend/.env</code> (key from{" "}
        <a href="https://hunter.io/api-keys" target="_blank" rel="noreferrer" className="text-crimson underline">
          hunter.io/api-keys
        </a>
        ), then restart ./dev.sh.
      </EmptyState>
    );
  }

  const maxCredits = companies.length * searchCost(perCompany);

  return (
    <div className="space-y-6">
      {/* Search */}
      <form
        className="-mx-4 border-y border-cloud bg-paper p-5 sm:mx-0 sm:rounded-3xl sm:border sm:p-6 sm:shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
      >
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div>
            <span className="text-sm font-semibold text-ink">Companies</span>
            <span className="ml-2 text-xs text-steel">type a name and pick from the list, or paste several</span>
            <div className="mt-2 flex min-h-[7.5rem] flex-wrap content-start items-center gap-2 rounded-2xl border border-steel/25 bg-cloud/40 p-2.5 focus-within:border-scarlet focus-within:bg-paper focus-within:ring-4 focus-within:ring-scarlet/10">
              {chips.map((c) => (
                <span
                  key={c.query}
                  className="flex max-w-full items-center gap-2 rounded-xl border border-cloud bg-paper py-1 pr-1.5 pl-1.5 text-sm shadow-sm"
                >
                  <CompanyLogo domain={c.domain} size={22} />
                  <span className="truncate font-medium text-ink">{c.label}</span>
                  {c.domain && c.domain !== c.label && <span className="truncate text-xs text-steel">{c.domain}</span>}
                  <button
                    type="button"
                    onClick={() => setChips(chips.filter((x) => x.query !== c.query))}
                    className="rounded-md p-0.5 text-steel hover:bg-cloud hover:text-crimson"
                    aria-label={`Remove ${c.label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <CompanyAutocomplete
                ariaLabel="Add a company"
                value={draftCompany}
                onChange={setDraftCompany}
                onPick={(sug) => addChips([{ query: sug.domain, label: sug.name || sug.domain, domain: sug.domain }])}
                onSubmitRaw={(text) => addChips([textChip(text)])}
                onBackspaceEmpty={() => setChips(chips.slice(0, -1))}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (!/[\n,]/.test(text)) return;
                  e.preventDefault();
                  addChips(textToChips(text));
                }}
                placeholder={chips.length ? "Add another company" : "e.g. Harvey, Shopify, stripe.com"}
                className="min-w-48 flex-1 px-1.5"
              />
            </div>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Job title</span>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="software engineer"
                className="mt-2 w-full rounded-xl border border-steel/25 px-3 py-2.5 text-sm text-ink outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10"
              />
              <span className="mt-1 block text-xs text-steel">Any seniority. Separate several titles with commas.</span>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Location</span>
              <Select
                ariaLabel="Location"
                value={location}
                onChange={setLocation}
                options={LOCATIONS.map((l) => ({ value: l.id, label: l.label }))}
                className="mt-2 w-full"
              />
              <span className="mt-1 block text-xs text-steel">Where each person is based, not the company’s HQ.</span>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">People per company</span>
              <Select
                ariaLabel="People per company"
                value={perCompany}
                onChange={setPerCompany}
                options={PER_COMPANY.map((n) => ({ value: n, label: `Up to ${n}`, hint: `up to ${creditsText(searchCost(n))}` }))}
                className="mt-2 w-full"
              />
            </label>
            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={hideSeen}
                onChange={(e) => setHideSeen(e.target.checked)}
                className="mt-0.5 size-4 accent-crimson"
              />
              <span>
                Hide people I’ve already seen
                <span className="block text-xs text-steel">For “Get new people”: also skip anyone shown to you before, not just people you’ve emailed.</span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-cloud pt-5">
          <span className="text-xs text-steel">
            {status?.credits_remaining != null && (
              <>
                <span className="font-semibold text-ink">{status.credits_remaining}</span>
                {status.credits_total != null && <> of {status.credits_total}</>} credits left
                {status.reset_date && <> (resets {formatDate(status.reset_date)})</>} ·{" "}
              </>
            )}
            {companies.length > 0
              ? `uses up to ${creditsText(maxCredits)} (1 per 10 people found, per company)`
              : "1 credit per 10 people found"}
            {" · "}free if no one is found or you’ve searched it before
          </span>
          <Button type="submit" variant="primary" disabled={!companies.length || searching}>
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search {companies.length > 1 ? `${companies.length} companies` : ""}
          </Button>
        </div>
      </form>

      {/* Results */}
      {results.map((r) => {
        const total = r.search?.total ?? 0;
        const hasMore = !r.fresh && !!r.search && r.search.offset + r.search.limit < total;
        const allSelected = r.people.length > 0 && r.people.every((p) => r.selected.includes(p.email));
        return (
          <section key={r.query} className="animate-fade-up -mx-4 overflow-hidden border-y border-cloud bg-paper sm:mx-0 sm:rounded-3xl sm:border sm:shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cloud px-5 py-4">
              <div className="flex items-center gap-3">
                <CompanyLogo domain={r.search?.domain ?? chips.find((c) => c.query === r.query)?.domain} size={40} />
                <div>
                  <p className="font-semibold text-ink">{r.search?.organization ?? r.query}</p>
                  <p className="text-xs text-steel">
                    {r.search?.domain ?? (r.state === "loading" ? "Searching…" : r.query)}
                    {r.state === "done" && (
                      <>
                        {" "}· {r.people.length} of {total} {r.filterLabel || "people"}
                        <EmailedCount people={r.people} />
                      </>
                    )}
                  </p>
                </div>
              </div>
              {r.state === "done" && r.people.length > 0 && (
                <div className="flex items-center gap-3">
                  {r.search?.cached && (
                    <button
                      onClick={() => fetchCompany(r.query, 0, true, r.filters)}
                      className="rounded-full bg-cloud px-2.5 py-1 text-xs whitespace-nowrap text-steel hover:bg-steel/20"
                      title="Saved earlier, so no credits were used. Click to search Hunter again (Hunter doesn’t charge for repeating a search in the same month)."
                    >
                      saved results · refresh
                    </button>
                  )}
                  <Button variant="primary" className="whitespace-nowrap" disabled={!r.selected.length} onClick={() => emailThese(r)}>
                    Email {r.selected.length} {r.selected.length === 1 ? "person" : "people"}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
            </header>

            {r.state === "loading" && !r.people.length && (
              <div className="flex items-center gap-2 px-5 py-8 text-sm text-steel">
                <Loader2 className="size-4 animate-spin" /> Searching Hunter…
              </div>
            )}
            {r.state === "error" && <p className="px-5 py-5 text-sm text-crimson">{r.error}</p>}
            {r.note && (
              <p className={`border-b border-cloud px-5 py-3 text-sm ${r.people.length ? "bg-cloud/30 text-ink/80" : "text-steel"}`}>{r.note}</p>
            )}
            {r.state === "done" && r.people.length === 0 && !r.fresh && (
              <EmptyResultHelp
                company={r.search?.domain ?? r.query}
                organization={r.search?.organization ?? null}
                filterLabel={r.filterLabel ?? ""}
                retryCost={`Up to ${creditsText(searchCost(perCompany))}`}
                onAnywhere={
                  r.filters && r.filters.location !== "any"
                    ? () => fetchCompany(r.query, 0, false, { ...r.filters!, location: "any" })
                    : undefined
                }
                onWithoutTitle={
                  r.filters?.jobTitle.trim() ? () => fetchCompany(r.query, 0, false, { ...r.filters!, jobTitle: "" }) : undefined
                }
              />
            )}

            {r.people.length > 0 && (
              <>
                <label className="flex cursor-pointer items-center gap-3 border-b border-cloud bg-cloud/30 px-4 py-2 text-xs font-medium text-steel">
                  <input
                    type="checkbox"
                    className="size-4 accent-crimson"
                    checked={allSelected}
                    onChange={() => update(r.query, { selected: allSelected ? [] : r.people.map((p) => p.email) })}
                  />
                  Select all
                </label>
                <ul className="divide-y divide-cloud">
                  {r.people.map((p) => (
                    <li key={p.email}>
                      <PersonRow person={p} selected={r.selected.includes(p.email)} onToggle={() => toggle(r.query, p.email)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {r.search && total > 0 && r.state !== "error" && (r.people.length > 0 || r.fresh) && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-cloud px-4 py-2">
                {hasMore && (
                  <Button variant="ghost" disabled={r.state === "loading"} onClick={() => fetchCompany(r.query, r.search!.offset + r.search!.limit, false, r.filters)}>
                    {r.state === "loading" && <Loader2 className="size-4 animate-spin" />}
                    Load more (up to {creditsText(searchCost(perCompany))})
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={r.state === "loading"}
                  onClick={() => getNew(r)}
                  title="Skips everyone you’ve already emailed. Pages Popsicle has already fetched are free; only new pages use credits."
                >
                  {r.state === "loading" && !hasMore && <Loader2 className="size-4 animate-spin" />}
                  <Sparkles className="size-4" /> Get {perCompany} new people
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
