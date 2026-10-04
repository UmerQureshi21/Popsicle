"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, Loader2, Search, UserSearch } from "lucide-react";
import { api, type FoundPerson, type PeopleSearch } from "@/lib/api";
import { creditsChanged, creditsText, searchCost, useHunterStatus } from "@/lib/credits";
import { formatDate } from "@/lib/format";
import { DEFAULT_LOCATION, LOCATIONS, locationById, type LocationId } from "@/lib/locations";
import { saveHandoff } from "@/lib/people";
import { Button, EmptyState } from "@/components/ui";
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
};

type Saved = {
  companiesText: string;
  jobTitle: string;
  location: LocationId;
  perCompany: number;
  results: CompanyResult[];
};

const STORAGE_KEY = "popsicle:find-people:v1";
const PER_COMPANY = [5, 10, 25];
const DEFAULTS: Saved = {
  companiesText: "",
  jobTitle: "software engineer",
  location: DEFAULT_LOCATION,
  perCompany: 10,
  results: [],
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved: Saved = { ...DEFAULTS, ...JSON.parse(raw) };
      // A search interrupted by leaving the page can't finish; show it as failed instead of spinning.
      saved.results = saved.results.map((r) =>
        r.state === "loading" ? { ...r, state: "error", error: "Interrupted. Search again." } : r,
      );
      return saved;
    }
  } catch {}
  return DEFAULTS;
}

function parseCompanies(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

export default function FindPeople() {
  const router = useRouter();
  const [initial] = useState(load);
  const [companiesText, setCompaniesText] = useState(initial.companiesText);
  const [jobTitle, setJobTitle] = useState(initial.jobTitle);
  const [location, setLocation] = useState<LocationId>(initial.location);
  const [perCompany, setPerCompany] = useState(initial.perCompany);
  const [results, setResults] = useState<CompanyResult[]>(initial.results);
  const status = useHunterStatus();
  const [searching, setSearching] = useState(false);


  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ companiesText, jobTitle, location, perCompany, results }));
    } catch {}
  }, [companiesText, jobTitle, location, perCompany, results]);

  const companies = parseCompanies(companiesText);
  const update = (query: string, patch: Partial<CompanyResult> | ((r: CompanyResult) => Partial<CompanyResult>)) =>
    setResults((prev) => prev.map((r) => (r.query === query ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));

  const fetchCompany = async (query: string, offset = 0, refresh = false) => {
    update(query, { state: "loading", error: undefined });
    try {
      const res = await api.post<PeopleSearch>("/api/people-search/company", {
        query,
        limit: perCompany,
        offset,
        job_titles: jobTitle.trim() || null,
        location: locationById(location).filters,
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
          filterLabel: [jobTitle.trim() && `matching “${jobTitle.trim()}”`, locationById(location).short].filter(Boolean).join(" "),
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
        className="rounded-3xl border border-cloud bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
      >
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Companies</span>
            <span className="ml-2 text-xs text-steel">one per line · name or domain</span>
            <textarea
              value={companiesText}
              onChange={(e) => setCompaniesText(e.target.value)}
              rows={Math.min(8, Math.max(4, companiesText.split("\n").length + 1))}
              placeholder={"stripe.com\nFigma\nnotion.so"}
              spellCheck={false}
              className="mt-2 w-full resize-y rounded-2xl border border-steel/25 bg-cloud/40 px-4 py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-steel/60 focus:border-scarlet focus:bg-white focus:ring-4 focus:ring-scarlet/10"
            />
          </label>
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
        const hasMore = !!r.search && r.search.offset + r.search.limit < total;
        const allSelected = r.people.length > 0 && r.people.every((p) => r.selected.includes(p.email));
        return (
          <section key={r.query} className="animate-fade-up overflow-hidden rounded-3xl border border-cloud bg-white shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cloud px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-cloud text-ink">
                  <Building2 className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-ink">{r.search?.organization ?? r.query}</p>
                  <p className="text-xs text-steel">
                    {r.search?.domain ?? (r.state === "loading" ? "Searching…" : r.query)}
                    {r.state === "done" && (
                      <>
                        {" "}· {r.people.length} of {total} {r.filterLabel || "people"}
                      </>
                    )}
                  </p>
                </div>
              </div>
              {r.state === "done" && r.people.length > 0 && (
                <div className="flex items-center gap-3">
                  {r.search?.cached && (
                    <button
                      onClick={() => fetchCompany(r.query, 0, true)}
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
            {r.state === "done" && r.people.length === 0 && (
              <p className="px-5 py-8 text-sm text-steel">
                Hunter has no one {r.filterLabel || "for this search"} at this company. Try the company’s domain, a
                broader title like “engineer”, or a wider location.
              </p>
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
                {hasMore && (
                  <div className="border-t border-cloud py-2 text-center">
                    <Button
                      variant="ghost"
                      disabled={r.state === "loading"}
                      onClick={() =>
                        fetchCompany(r.query, r.search!.offset + r.search!.limit)
                      }
                    >
                      {r.state === "loading" && <Loader2 className="size-4 animate-spin" />}
                      Load more (up to {creditsText(searchCost(perCompany))})
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
