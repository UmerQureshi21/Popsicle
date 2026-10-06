"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AtSign, Check, Copy, ExternalLink, Loader2, Plus, Search, Send, X } from "lucide-react";
import { api, type EmailFinderResult } from "@/lib/api";
import { creditsChanged, useHunterStatus } from "@/lib/credits";
import { formatDate, timeAgo } from "@/lib/format";
import { saveHandoff } from "@/lib/people";
import { Avatar, Button, EmptyState } from "@/components/ui";
import CompanyAutocomplete, { CompanyLogo } from "@/components/CompanyAutocomplete";
import { ConfidencePill } from "@/components/PersonRow";

type Lookup = {
  id: string;
  name: string;
  linkedin: string;
  company: string;
  result: EmailFinderResult;
  at: string;
};

const STORAGE_KEY = "popsicle:lookups:v1";
const KEEP = 25;

const VERIFICATION: Record<string, { label: string; tone: string }> = {
  valid: { label: "Verified", tone: "bg-emerald-50 text-emerald-700" },
  accept_all: { label: "Company accepts all emails", tone: "bg-cloud text-ink/80" },
  unknown: { label: "Not verified", tone: "bg-cloud text-steel" },
};

function load(): Lookup[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Find one person's email from their name (or LinkedIn) and company, via Hunter's Email Finder. */
export default function LookupPerson() {
  const router = useRouter();
  const status = useHunterStatus();
  const [name, setName] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [company, setCompany] = useState("");
  const [lookups, setLookups] = useState<Lookup[]>(load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lookups.slice(0, KEEP)));
    } catch {}
  }, [lookups]);

  const canSearch = !!company.trim() && !!(name.trim() || linkedin.trim()) && !busy;

  const lookUp = async () => {
    if (!canSearch) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<EmailFinderResult>("/api/people-search/person", {
        company: company.trim(),
        full_name: name.trim() || null,
        linkedin_url: linkedin.trim() || null,
      });
      setLookups((prev) => [
        { id: `${Date.now()}`, name: name.trim(), linkedin: linkedin.trim(), company: company.trim(), result, at: new Date().toISOString() },
        ...prev,
      ]);
      if (result.person) {
        setName("");
        setLinkedin("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      creditsChanged();
    }
  };

  const copy = async (email: string) => {
    await navigator.clipboard.writeText(email);
    setCopied(email);
    setTimeout(() => setCopied((c) => (c === email ? null : c)), 1500);
  };

  const toCompose = (l: Lookup, mode: "replace" | "append") => {
    if (!l.result.person) return;
    saveHandoff({ company: l.result.company ?? l.result.domain ?? l.company, people: [l.result.person], mode });
    router.push("/compose");
  };

  if (status && !status.configured) {
    return (
      <EmptyState icon={<AtSign className="size-5" />} title="Hunter isn’t set up yet">
        Add <code className="rounded bg-cloud px-1.5 py-0.5 text-ink">HUNTER_API_KEY=your-key</code> to{" "}
        <code className="rounded bg-cloud px-1.5 py-0.5 text-ink">backend/.env</code>, then restart ./dev.sh.
      </EmptyState>
    );
  }

  const field =
    "mt-2 w-full rounded-xl border border-steel/25 bg-white px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-steel/60 focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";

  return (
    <div className="space-y-6">
      <form
        className="-mx-4 border-y border-cloud bg-white p-5 sm:mx-0 sm:rounded-3xl sm:border sm:p-6 sm:shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          lookUp();
        }}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" className={field} />
            </label>
            <label className="mt-3 block">
              <span className="text-xs text-steel">or their LinkedIn profile</span>
              <input
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                placeholder="linkedin.com/in/jane-doe"
                className={field}
              />
            </label>
          </div>
          <div>
            <span className="text-sm font-semibold text-ink">Company</span>
            <CompanyAutocomplete
              ariaLabel="Company"
              value={company}
              onChange={setCompany}
              onPick={(s) => setCompany(s.domain)}
              placeholder="Company name or website, e.g. meta.com"
              leading={<Search className="size-4 shrink-0 text-steel" />}
              className="mt-2 rounded-xl border border-steel/25 bg-white px-3.5 focus-within:border-scarlet focus-within:ring-4 focus-within:ring-scarlet/10"
            />
            <p className="mt-2 text-xs leading-relaxed text-steel">
              Works for any company, even ones with no people in Hunter: it figures out the company’s email pattern. Their
              website domain (like <span className="text-ink">tiny-startup.io</span>) is the most reliable.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-cloud pt-5">
          <span className="text-xs text-steel">
            {status?.credits_remaining != null && (
              <>
                <span className="font-semibold text-ink">{status.credits_remaining}</span> credits left ·{" "}
              </>
            )}
            1 credit if an email is found · free if not, or if you’ve looked them up before
          </span>
          <Button type="submit" variant="primary" disabled={!canSearch}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <AtSign className="size-4" />}
            Find email
          </Button>
        </div>
        {error && <p className="mt-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson">{error}</p>}
      </form>

      {lookups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Recent lookups</h2>
            <button onClick={() => setLookups([])} className="text-xs text-steel hover:text-crimson">
              Clear
            </button>
          </div>
          {lookups.map((l) => {
            const p = l.result.person;
            const where = l.result.company || l.result.domain || l.company;
            const v = p?.verification_status ? VERIFICATION[p.verification_status] : null;
            return (
              <article
                key={l.id}
                className="animate-fade-up -mx-4 border-y border-cloud bg-white p-5 sm:mx-0 sm:rounded-3xl sm:border sm:shadow-sm"
              >
                <div className="flex items-start gap-4">
                  {p ? <Avatar name={p.full_name || p.email} size={44} /> : <CompanyLogo domain={l.result.domain} size={44} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{p?.full_name || l.name || l.linkedin}</p>
                      {p?.linkedin_url && (
                        <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-steel hover:text-ink" aria-label="LinkedIn profile">
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      {p?.already_emailed_at && (
                        <span className="rounded-full bg-crimson/10 px-2 py-0.5 text-[11px] font-medium text-crimson">
                          already emailed {formatDate(p.already_emailed_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-steel">
                      {[p?.position, where].filter(Boolean).join(" · ")} · {timeAgo(l.at)}
                    </p>

                    {p ? (
                      <>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold break-all text-ink">{p.email}</span>
                          <ConfidencePill value={p.confidence} />
                          {v && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${v.tone}`}>{v.label}</span>}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button variant="primary" onClick={() => toCompose(l, "replace")}>
                            <Send className="size-4" /> Email them
                          </Button>
                          <Button onClick={() => toCompose(l, "append")}>
                            <Plus className="size-4" /> Add to batch
                          </Button>
                          <Button variant="ghost" onClick={() => copy(p.email)}>
                            {copied === p.email ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                            {copied === p.email ? "Copied" : "Copy"}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-sm leading-relaxed text-ink/80">
                        Hunter couldn’t find an email for them at {l.result.domain || l.company}. No credit was used. Try the
                        company’s exact website domain, or their LinkedIn profile instead of their name.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setLookups((prev) => prev.filter((x) => x.id !== l.id))}
                    className="rounded-lg p-1.5 text-steel hover:bg-cloud hover:text-crimson"
                    aria-label="Remove from recent lookups"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
