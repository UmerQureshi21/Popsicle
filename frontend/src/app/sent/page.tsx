"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Send, Trash2 } from "lucide-react";
import { api, type CampaignDetail, type CampaignSummary, type Stats } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Button, EmptyState, StatusBadge } from "@/components/ui";
import CampaignProgress, { ProgressBar, isActive } from "@/components/CampaignProgress";
import PageShell from "@/components/PageShell";
import SendingSafety from "@/components/SendingSafety";

function StatTile({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-cloud bg-white p-5 shadow-sm">
      <p className="text-sm text-steel">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tracking-tight ${accent ? "text-crimson" : "text-ink"}`}>{value}</p>
    </div>
  );
}

export default function SentPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.get<Stats>("/api/stats").then(setStats, () => {});
    api.get<CampaignSummary[]>("/api/campaigns").then(setCampaigns, (e) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  // Keep the list fresh while anything is sending.
  const anyActive = campaigns?.some(isActive) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [anyActive, refresh]);

  const toggle = async (id: number) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetail(await api.get<CampaignDetail>(`/api/campaigns/${id}`));
  };

  const remove = async (c: CampaignSummary) => {
    if (!confirm(`Delete "${c.name}" and its send history? People in it will no longer count as already emailed.`)) return;
    try {
      await api.del(`/api/campaigns/${c.id}`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <PageShell title="Sent" subtitle="Every batch you’ve sent, and what happened to each email.">
      {/* Re-read the daily limit whenever the number of emails sent changes. */}
      <SendingSafety refreshKey={stats?.sent_total ?? 0} />

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Emails sent" value={stats?.sent_total ?? "–"} accent />
        <StatTile label="Last 7 days" value={stats?.sent_last_7_days ?? "–"} />
        <StatTile label="Companies" value={stats?.companies ?? "–"} />
        <StatTile label="Contacts" value={stats?.contacts ?? "–"} />
      </div>

      {error && <p className="mb-4 rounded-xl bg-crimson/5 px-4 py-3 text-sm text-crimson">{error}</p>}

      {campaigns && campaigns.length === 0 && (
        <EmptyState icon={<Send className="size-5" />} title="Nothing sent yet">
          Batches you send from Compose show up here.
        </EmptyState>
      )}

      <div className="space-y-3">
        {campaigns?.map((c) => {
          const toSend = c.counts.total - c.counts.skipped;
          const open = openId === c.id;
          return (
            <div key={c.id} className="overflow-hidden rounded-2xl border border-cloud bg-white shadow-sm">
              <button onClick={() => toggle(c.id)} className="flex w-full items-center gap-5 px-5 py-4 text-left hover:bg-cloud/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-steel">
                    {c.counts.total} recipient{c.counts.total === 1 ? "" : "s"} · {formatDateTime(c.created_at)}
                  </p>
                </div>
                <div className="hidden w-48 sm:block">
                  <div className="mb-1.5 flex justify-between text-xs text-steel">
                    <span>
                      {c.counts.sent}/{toSend} sent
                    </span>
                    {c.counts.failed > 0 && <span className="text-crimson">{c.counts.failed} failed</span>}
                  </div>
                  <ProgressBar sent={c.counts.sent} failed={c.counts.failed} total={toSend} />
                </div>
                <ChevronDown className={`size-5 shrink-0 text-steel transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {open && (
                <div className="border-t border-cloud bg-cloud/20 px-5 py-5">
                  {!detail ? (
                    <p className="text-sm text-steel">Loading…</p>
                  ) : (
                    <div className="space-y-5">
                      <div className="rounded-2xl border border-cloud bg-white p-5">
                        <p className="text-xs font-semibold tracking-wide text-steel uppercase">Template used</p>
                        <p className="mt-2 font-medium text-ink">{detail.subject_template}</p>
                        <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap text-ink/80">{detail.body_template}</p>
                        <p className="mt-3 font-mono text-xs text-steel">({detail.variables.join(", ")})</p>
                      </div>
                      <CampaignProgress
                        key={detail.id}
                        initial={detail}
                        onChange={(d) => {
                          setDetail(d);
                          if (!isActive(d)) refresh();
                        }}
                      />
                      <div className="flex justify-between border-t border-cloud pt-4 text-xs text-steel">
                        <span>
                          Started {timeAgo(detail.started_at)}
                          {detail.finished_at && <> · finished {timeAgo(detail.finished_at)}</>}
                        </span>
                        {!isActive(c) && (
                          <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => remove(c)}>
                            <Trash2 className="size-3.5" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
