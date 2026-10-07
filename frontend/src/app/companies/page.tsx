"use client";

import { safeHref } from "@/lib/safeUrl";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ExternalLink, ImageDown, Plus, Trash2, UserSearch, X } from "lucide-react";
import { api, type CompaniesAdded, type Company, type CompanyStatus, type Contact } from "@/lib/api";
import { textChip, textToChips, type Chip } from "@/lib/chips";
import { COMPANIES_PIECE, inPieces } from "@/lib/pieces";
import { formatDate, timeAgo } from "@/lib/format";
import { Avatar, Button, EmptyState, Modal, StatusBadge } from "@/components/ui";
import CompanyAutocomplete, { CompanyLogo } from "@/components/CompanyAutocomplete";
import { presetCompanies } from "@/components/find/FindPeople";
import PageShell from "@/components/PageShell";
import Select from "@/components/Select";

const COMPANY_STATUSES: { value: CompanyStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "emailed", label: "Emailed" },
  { value: "replied", label: "Replied" },
  { value: "not_interested", label: "Not a fit" },
];

const DOT: Record<CompanyStatus, string> = {
  not_started: "bg-steel/50",
  emailed: "bg-crimson",
  replied: "bg-emerald-500",
  not_interested: "bg-ink/30",
};

type Filter = CompanyStatus | "all";

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  // Adding: chips typed, picked from Hunter's suggestions, or pasted as a list.
  const [adding, setAdding] = useState(false);
  const [newChips, setNewChips] = useState<Chip[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    api.get<Company[]>("/api/companies").then(setCompanies, (e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const open = async (c: Company) => {
    setSelected(c);
    setContacts(null);
    setContacts(await api.get<Contact[]>(`/api/contacts?company_id=${c.id}`));
  };

  const setStatus = async (c: Company, status: CompanyStatus) => {
    setCompanies((list) => list?.map((x) => (x.id === c.id ? { ...x, status } : x)) ?? null);
    try {
      await api.patch(`/api/companies/${c.id}`, { status });
    } catch (e) {
      setError((e as Error).message);
      refresh();
    }
  };

  const addChips = (added: Chip[]) => {
    setNewChips((prev) => {
      const seen = new Set(prev.map((c) => c.query.toLowerCase()));
      return [...prev, ...added.filter((c) => !seen.has(c.query.toLowerCase()) && seen.add(c.query.toLowerCase()))];
    });
    setDraft("");
  };

  const closeAdd = () => {
    setAdding(false);
    setNewChips([]);
    setDraft("");
  };

  const add = async () => {
    const lines = [...newChips.map((c) => c.query), ...(draft.trim() ? [draft.trim()] : [])];
    setSaving(true);
    setError(null);
    try {
      // A long pasted list goes in pieces, so no request runs long.
      const res: CompaniesAdded = { added: [], skipped: [] };
      for (const piece of inPieces(lines, COMPANIES_PIECE)) {
        const part = await api.post<CompaniesAdded>("/api/companies/bulk", { lines: piece });
        res.added.push(...part.added);
        res.skipped.push(...part.skipped);
      }
      const n = res.added.length;
      setNotice(
        `Added ${n} compan${n === 1 ? "y" : "ies"}` +
          (res.skipped.length ? `; ${res.skipped.join(", ")} ${res.skipped.length === 1 ? "was" : "were"} already on your list.` : "."),
      );
      setFilter("all");
      closeAdd();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fillDomains = async () => {
    setFilling(true);
    setError(null);
    try {
      // The backend looks up a few at a time and says where to carry on.
      let filled = 0;
      let missing = 0;
      let after: number | null = 0;
      while (after !== null) {
        const res: { filled: number; missing: number; next_after?: number | null } = await api.post(
          `/api/companies/fill-domains?after_id=${after}`,
        );
        filled += res.filled;
        missing = res.missing;
        // Only carry on when the backend names a later starting point (never loop on the same piece).
        after = typeof res.next_after === "number" && res.next_after > after ? res.next_after : null;
      }
      setNotice(
        filled
          ? `Found ${filled} domain${filled === 1 ? "" : "s"}.` + (missing ? ` Hunter didn’t know ${missing}; add those by hand.` : "")
          : "Hunter didn’t recognise any of those names. Add their domains by hand.",
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFilling(false);
    }
  };

  const remove = async (c: Company) => {
    if (!confirm(`Delete ${c.name}? Its contacts and sent history are kept.`)) return;
    await api.del(`/api/companies/${c.id}`);
    setSelected(null);
    setPicked((p) => new Set([...p].filter((id) => id !== c.id)));
    refresh();
  };

  const togglePick = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const findPeople = () => {
    const chosen = (companies ?? []).filter((c) => picked.has(c.id));
    presetCompanies(chosen.map((c) => (c.domain ? { query: c.domain, label: c.name, domain: c.domain } : textChip(c.name))));
    router.push("/find");
  };

  const counts = Object.fromEntries(COMPANY_STATUSES.map((s) => [s.value, 0])) as Record<CompanyStatus, number>;
  companies?.forEach((c) => counts[c.status]++);
  const shown = companies?.filter((c) => filter === "all" || c.status === filter) ?? [];
  const noDomain = companies?.filter((c) => !c.domain).length ?? 0;
  const pickedShown = shown.filter((c) => picked.has(c.id));

  return (
    <PageShell
      title="Companies"
      subtitle="Your target list: who’s left to email, who you’ve emailed, and who replied."
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add companies
        </Button>
      }
    >
      {companies && companies.length === 0 && (
        <EmptyState icon={<Building2 className="size-5" />} title="No companies yet">
          Add the companies you want to reach, or they’re added automatically when you send a batch.
        </EmptyState>
      )}

      {!!companies?.length && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {[{ value: "all" as Filter, label: "All", n: companies.length }, ...COMPANY_STATUSES.map((s) => ({ ...s, n: counts[s.value] }))].map(
              (t) => (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={filter === t.value}
                  onClick={() => setFilter(t.value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    filter === t.value ? "bg-night text-white" : "bg-paper text-steel ring-1 ring-cloud hover:text-ink"
                  }`}
                >
                  {t.label} <span className={filter === t.value ? "text-white/70" : "text-steel/70"}>{t.n}</span>
                </button>
              ),
            )}
          </div>
          {noDomain > 0 && (
            <Button onClick={fillDomains} disabled={filling}>
              <ImageDown className="size-4" /> {filling ? "Looking up…" : `Find ${noDomain} missing logo${noDomain === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      )}

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-4 py-2.5 text-sm text-ink">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-steel hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
      {error && !adding && <p className="mb-4 text-sm text-crimson">{error}</p>}

      {companies && companies.length > 0 && shown.length === 0 && (
        <p className="rounded-2xl border border-dashed border-steel/40 bg-paper px-6 py-10 text-center text-sm text-steel">
          No companies are {COMPANY_STATUSES.find((s) => s.value === filter)?.label.toLowerCase()}.
        </p>
      )}

      <div className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <div
            key={c.id}
            className={`flex flex-col rounded-2xl border bg-paper p-5 shadow-sm transition hover:shadow-md ${
              picked.has(c.id) ? "border-crimson ring-2 ring-crimson/15" : "border-cloud hover:border-steel/30"
            }`}
          >
            <div className="flex items-start gap-3">
              <CompanyLogo domain={c.domain} size={44} />
              <button onClick={() => open(c)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold text-ink hover:underline">{c.name}</span>
                <span className="block truncate text-sm text-steel">{c.domain ?? "no domain yet"}</span>
              </button>
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={() => togglePick(c.id)}
                aria-label={`Select ${c.name}`}
                className="mt-1 size-4 shrink-0 accent-crimson"
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden />
              <Select
                ariaLabel={`Status of ${c.name}`}
                value={c.status}
                onChange={(s) => setStatus(c, s)}
                options={COMPANY_STATUSES}
                className="flex-1"
              />
            </div>
            <div className="mt-4 flex gap-4 border-t border-cloud pt-3 text-xs text-steel">
              <span>
                <span className="font-semibold text-ink">{c.emailed_count}</span>/{c.contact_count} emailed
              </span>
              <span>last {timeAgo(c.last_sent_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {pickedShown.length > 0 && (
        <div className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-night px-4 py-3 text-sm text-white shadow-xl md:bottom-6">
          <span>
            {pickedShown.length} selected
            <button onClick={() => setPicked(new Set())} className="ml-3 text-white/70 underline underline-offset-2 hover:text-white">
              Clear
            </button>
          </span>
          <Button variant="primary" onClick={findPeople}>
            <UserSearch className="size-4" /> Find people at {pickedShown.length === 1 ? pickedShown[0].name : `${pickedShown.length} companies`}
          </Button>
        </div>
      )}

      <Modal open={adding} onClose={closeAdd} title="Add companies">
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <p className="text-sm text-steel">
            Type a name and pick it from the list, or paste a whole list (one per line, or separated by commas). Names and domains both work;
            Hunter fills in the rest for free.
          </p>
          <div className="flex min-h-[7.5rem] flex-wrap content-start items-center gap-2 rounded-2xl border border-steel/25 bg-cloud/40 p-2.5 focus-within:border-scarlet focus-within:bg-paper focus-within:ring-4 focus-within:ring-scarlet/10">
            {newChips.map((c) => (
              <span key={c.query} className="flex max-w-full items-center gap-2 rounded-xl border border-cloud bg-paper py-1 pr-1.5 pl-1.5 text-sm shadow-sm">
                <CompanyLogo domain={c.domain} size={22} />
                <span className="truncate font-medium text-ink">{c.label}</span>
                <button
                  type="button"
                  onClick={() => setNewChips(newChips.filter((x) => x.query !== c.query))}
                  className="rounded-md p-0.5 text-steel hover:bg-cloud hover:text-crimson"
                  aria-label={`Remove ${c.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <CompanyAutocomplete
              ariaLabel="Company name or domain"
              value={draft}
              onChange={setDraft}
              onPick={(s) => addChips([{ query: s.domain, label: s.name || s.domain, domain: s.domain }])}
              onSubmitRaw={(text) => addChips([textChip(text)])}
              onBackspaceEmpty={() => setNewChips(newChips.slice(0, -1))}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (!/[\n,]/.test(text)) return;
                e.preventDefault();
                addChips(textToChips(text));
              }}
              placeholder={newChips.length ? "Add another" : "e.g. Shopify, Wealthsimple, stripe.com"}
              autoFocus
              className="min-w-48 flex-1 px-1.5"
            />
          </div>
          {error && <p className="text-sm text-crimson">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={closeAdd}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || (!newChips.length && !draft.trim())}>
              {saving ? "Adding…" : `Add ${newChips.length + (draft.trim() ? 1 : 0) || ""}`.trim()}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          <span className="flex items-center gap-2">
            <CompanyLogo domain={selected?.domain} size={24} />
            {selected?.name}
            {safeHref(selected?.linkedin_url) && (
              <a href={safeHref(selected?.linkedin_url)} target="_blank" rel="noreferrer" className="text-steel hover:text-ink">
                <ExternalLink className="size-4" />
              </a>
            )}
          </span>
        }
        footer={
          selected && (
            <div className="flex justify-between">
              <Button variant="danger" onClick={() => remove(selected)}>
                <Trash2 className="size-4" /> Delete company
              </Button>
              <span className="self-center text-xs text-steel">Added {formatDate(selected.created_at)}</span>
            </div>
          )
        }
      >
        <div className="p-6">
          {!contacts ? (
            <p className="text-sm text-steel">Loading…</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-steel">No contacts at this company yet.</p>
          ) : (
            <ul className="divide-y divide-cloud">
              {contacts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <Avatar name={p.full_name || p.email} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{p.full_name || p.email}</p>
                    <p className="truncate text-xs text-steel">
                      {p.email}
                      {p.title && <> · {p.title}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    {p.last_status && <StatusBadge status={p.last_status} />}
                    <p className="mt-0.5 text-xs text-steel">{p.last_sent_at ? formatDate(p.last_sent_at) : "not emailed"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </PageShell>
  );
}
