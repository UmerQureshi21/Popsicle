"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, RotateCcw, Square, XCircle } from "lucide-react";
import { API_URL, api, type CampaignDetail, type EmailStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button, StatusBadge } from "@/components/ui";

const ACTIVE = new Set(["queued", "sending"]);

export function isActive(c: { status: string }) {
  return ACTIVE.has(c.status);
}

export function ProgressBar({ sent, failed, total }: { sent: number; failed: number; total: number }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-cloud">
      <div className="h-full bg-crimson transition-all duration-500" style={{ width: pct(sent) }} />
      <div className="h-full bg-ink/70 transition-all duration-500" style={{ width: pct(failed) }} />
    </div>
  );
}

const ICONS: Record<EmailStatus, React.ReactNode> = {
  sent: <CheckCircle2 className="size-4 text-crimson" />,
  failed: <XCircle className="size-4 text-ink" />,
  pending: <CircleDashed className="size-4 text-steel" />,
  skipped: <CircleSlash className="size-4 text-steel" />,
  cancelled: <CircleSlash className="size-4 text-steel" />,
};

/** Live view of one campaign: polls while sending, offers cancel / resume / retry. */
export default function CampaignProgress({
  initial,
  onChange,
}: {
  initial: CampaignDetail;
  onChange?: (c: CampaignDetail) => void;
}) {
  const [campaign, setCampaign] = useState(initial);
  const [busy, setBusy] = useState(false);
  const active = isActive(campaign);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const c = await api.get<CampaignDetail>(`/api/campaigns/${campaign.id}`);
        setCampaign(c);
        onChange?.(c);
      } catch {}
    }, 1500);
    return () => clearInterval(t);
  }, [active, campaign.id, onChange]);

  const act = async (path: string) => {
    setBusy(true);
    try {
      const c = await api.post<CampaignDetail>(`/api/campaigns/${campaign.id}/${path}`);
      setCampaign(c);
      onChange?.(c);
    } finally {
      setBusy(false);
    }
  };

  const { counts } = campaign;
  const toSend = counts.total - counts.skipped;
  const gmailProblem = campaign.error?.toLowerCase().includes("gmail");
  const nextPending = campaign.emails.find((e) => e.status === "pending");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="text-ink">
              <span className="font-semibold">{counts.sent}</span> of {toSend} sent
              {counts.failed > 0 && <span className="text-crimson"> · {counts.failed} failed</span>}
              {counts.skipped > 0 && <span className="text-steel"> · {counts.skipped} skipped</span>}
            </span>
          </span>
          {active && nextPending && (
            <span className="flex items-center gap-1.5 text-xs text-steel">
              <Loader2 className="size-3.5 animate-spin" /> next: {nextPending.to_email}
            </span>
          )}
        </div>
        <ProgressBar sent={counts.sent} failed={counts.failed} total={toSend} />
      </div>

      {campaign.error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson">
          <span>{campaign.error}</span>
          {gmailProblem && (
            <a href={`${API_URL}/api/gmail/connect`} className="shrink-0 font-semibold underline underline-offset-2">
              Connect Gmail
            </a>
          )}
        </div>
      )}

      <ul className="divide-y divide-cloud rounded-2xl border border-cloud">
        {campaign.emails.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {ICONS[e.status]}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{e.to_email}</span>
              {e.error && <span className="block truncate text-xs text-steel">{e.error}</span>}
            </span>
            <span className="shrink-0 text-xs text-steel">{e.sent_at ? formatDateTime(e.sent_at) : e.status}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap justify-end gap-2">
        {active && (
          <Button variant="danger" disabled={busy} onClick={() => act("cancel")}>
            <Square className="size-3.5" /> Stop sending
          </Button>
        )}
        {(campaign.status === "interrupted" || (campaign.status === "cancelled" && counts.cancelled > 0)) && (
          <Button variant="primary" disabled={busy} onClick={() => act("resume")}>
            <RotateCcw className="size-4" /> Resume
          </Button>
        )}
        {!active && counts.failed > 0 && (
          <Button disabled={busy} onClick={() => act("resume?retry_failed=true")}>
            <RotateCcw className="size-4" /> Retry {counts.failed} failed
          </Button>
        )}
      </div>
    </div>
  );
}
