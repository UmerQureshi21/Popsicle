"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, ExternalLink, Plus, Trash2 } from "lucide-react";
import { api, type Company, type Contact } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { Avatar, Button, EmptyState, Modal, StatusBadge } from "@/components/ui";
import PageShell from "@/components/PageShell";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [selected, setSelected] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", linkedin_url: "" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.get<Company[]>("/api/companies").then(setCompanies, (e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const open = async (c: Company) => {
    setSelected(c);
    setContacts(null);
    setContacts(await api.get<Contact[]>(`/api/contacts?company_id=${c.id}`));
  };

  const add = async () => {
    setError(null);
    try {
      await api.post("/api/companies", {
        name: form.name.trim(),
        domain: form.domain.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
      });
      setForm({ name: "", domain: "", linkedin_url: "" });
      setAdding(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (c: Company) => {
    if (!confirm(`Delete ${c.name}? Its contacts and sent history are kept.`)) return;
    await api.del(`/api/companies/${c.id}`);
    setSelected(null);
    refresh();
  };

  return (
    <PageShell
      title="Companies"
      subtitle="Who you’ve reached out to, company by company."
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add company
        </Button>
      }
    >
      {companies && companies.length === 0 && (
        <EmptyState icon={<Building2 className="size-5" />} title="No companies yet">
          Companies are created automatically when you send a batch, or add one now to plan ahead.
        </EmptyState>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companies?.map((c) => (
          <button
            key={c.id}
            onClick={() => open(c)}
            className="group rounded-2xl border border-cloud bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-steel/30 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <span className="grid size-10 place-items-center rounded-xl bg-cloud text-lg font-semibold text-ink">
                {c.name[0]?.toUpperCase()}
              </span>
              {c.emailed_count > 0 ? (
                <span className="rounded-full bg-crimson/10 px-2 py-0.5 text-xs font-medium text-crimson">contacted</span>
              ) : (
                <span className="rounded-full bg-cloud px-2 py-0.5 text-xs font-medium text-steel">not yet</span>
              )}
            </div>
            <p className="mt-4 font-semibold text-ink">{c.name}</p>
            <p className="text-sm text-steel">{c.domain ?? " "}</p>
            <div className="mt-4 flex gap-4 border-t border-cloud pt-3 text-xs text-steel">
              <span>
                <span className="font-semibold text-ink">{c.emailed_count}</span>/{c.contact_count} emailed
              </span>
              <span>last {timeAgo(c.last_sent_at)}</span>
            </div>
          </button>
        ))}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add company">
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim()) add();
          }}
        >
          {(
            [
              ["name", "Name", "Stripe"],
              ["domain", "Domain", "stripe.com"],
              ["linkedin_url", "LinkedIn URL", "https://linkedin.com/company/stripe"],
            ] as const
          ).map(([key, label, ph]) => (
            <label key={key} className="block">
              <span className="text-sm font-medium text-ink">{label}</span>
              <input
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={ph}
                className="mt-1 w-full rounded-xl border border-steel/30 px-3 py-2 text-sm outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10"
              />
            </label>
          ))}
          {error && <p className="text-sm text-crimson">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!form.name.trim()}>
              Add
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          <span className="flex items-center gap-2">
            {selected?.name}
            {selected?.linkedin_url && (
              <a href={selected.linkedin_url} target="_blank" rel="noreferrer" className="text-steel hover:text-ink">
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
