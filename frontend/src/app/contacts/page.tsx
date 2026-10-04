"use client";

import { useEffect, useState } from "react";
import { Link2, Search, Trash2, Users } from "lucide-react";
import { api, type Company, type Contact } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, EmptyState, StatusBadge } from "@/components/ui";
import PageShell from "@/components/PageShell";
import Select from "@/components/Select";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get<Company[]>("/api/companies").then(setCompanies, () => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (companyId) params.set("company_id", companyId);
    const t = setTimeout(() => api.get<Contact[]>(`/api/contacts?${params}`).then(setContacts, () => setContacts([])), 200);
    return () => clearTimeout(t);
  }, [q, companyId, reload]);

  const remove = async (c: Contact) => {
    if (!confirm(`Remove ${c.full_name || c.email}? Their sent emails stay in history.`)) return;
    await api.del(`/api/contacts/${c.id}`);
    setReload((n) => n + 1);
  };

  return (
    <PageShell title="Contacts" subtitle="Everyone you’ve added through a batch. Contacts are matched by email address.">
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex min-w-64 flex-1 items-center gap-2 rounded-xl border border-steel/25 bg-white px-3 py-2 shadow-sm focus-within:border-scarlet">
          <Search className="size-4 text-steel" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or title"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-steel"
          />
        </label>
        <Select
          ariaLabel="Filter by company"
          value={companyId}
          onChange={setCompanyId}
          options={[{ value: "", label: "All companies" }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]}
          className="min-w-48 py-2 shadow-sm"
        />
      </div>

      {contacts && contacts.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title={q || companyId ? "No matches" : "No contacts yet"}>
          {q || companyId ? "Try a different search." : "People are added here automatically when you send a batch."}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-cloud bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-cloud bg-cloud/40 text-xs text-steel">
              <tr>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Emailed</th>
                <th className="px-5 py-3 font-medium">Last status</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {contacts?.map((c) => (
                <tr key={c.id} className="group border-b border-cloud last:border-0 hover:bg-cloud/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.full_name || c.email} size={32} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          {c.full_name || <span className="text-steel">Unknown name</span>}
                          {c.linkedin_url && (
                            <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-steel hover:text-ink">
                              <Link2 className="size-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="truncate text-xs text-steel">
                          {c.email}
                          {c.title && <> · {c.title}</>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink">{c.company_name ?? <span className="text-steel">—</span>}</td>
                  <td className="px-5 py-3 text-ink">
                    {c.sent_count > 0 ? (
                      <>
                        {c.sent_count}× <span className="text-steel">· {formatDate(c.last_sent_at)}</span>
                      </>
                    ) : (
                      <span className="text-steel">never</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{c.last_status && <StatusBadge status={c.last_status} />}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => remove(c)}
                      className="rounded-lg p-1.5 text-steel opacity-0 group-hover:opacity-100 hover:bg-white hover:text-crimson"
                      aria-label="Remove contact"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
