"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, type SendingQuota } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui";

/**
 * How much has been sent in the last 24 hours against the daily limit, with the limit and the
 * minimum gap between emails editable. Refetches whenever `refreshKey` changes.
 */
export default function SendingSafety({ refreshKey = 0 }: { refreshKey?: number }) {
  const [quota, setQuota] = useState<SendingQuota | null>(null);
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState("");
  const [gap, setGap] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SendingQuota>("/api/sending/quota").then(setQuota, () => {});
  }, [refreshKey]);

  if (!quota) return null;

  const startEditing = () => {
    setLimit(String(quota.daily_limit));
    setGap(String(quota.min_delay_seconds));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setQuota(
        await api.put<SendingQuota>("/api/sending/settings", { daily_limit: Number(limit), min_delay_seconds: Number(gap) }),
      );
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const used = Math.min(1, quota.sent_last_24h / Math.max(1, quota.daily_limit));
  const full = quota.remaining === 0;
  const field =
    "mt-1 w-24 rounded-lg border border-steel/30 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";

  return (
    <section aria-label="Sending safety" className="mb-8 rounded-2xl border border-cloud bg-paper p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cloud text-ink">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-ink">
              {quota.sent_last_24h} of {quota.daily_limit} sent in the last 24 hours
            </p>
            <p className={`text-sm ${full ? "font-medium text-crimson" : "text-steel"}`}>
              {full
                ? `Daily limit reached. More room at ${formatDateTime(quota.next_slot_at)}; waiting batches carry on by themselves.`
                : `${quota.remaining} more can go out today · at least ${quota.min_delay_seconds}s between emails`}
            </p>
          </div>
        </div>
        {!editing && (
          <Button variant="ghost" className="px-3 py-1.5" onClick={startEditing}>
            Edit limits
          </Button>
        )}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-cloud" aria-hidden>
        <div className={`h-full rounded-full transition-all ${full ? "bg-crimson" : "bg-night"}`} style={{ width: `${used * 100}%` }} />
      </div>

      {editing && (
        <form
          className="mt-5 flex flex-wrap items-end gap-4 border-t border-cloud pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="text-sm text-ink">
            Emails per 24 hours
            <input type="number" min={1} max={500} required value={limit} onChange={(e) => setLimit(e.target.value)} className={`block ${field}`} />
          </label>
          <label className="text-sm text-ink">
            Seconds between emails (at least)
            <input type="number" min={0} max={600} required value={gap} onChange={(e) => setGap(e.target.value)} className={`block ${field}`} />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
          <p className="w-full text-xs text-steel">
            Gmail flags accounts that suddenly send a lot, which sends later emails to spam. 30–50 a day is a safe range for
            cold email.
          </p>
          {error && <p className="w-full text-sm text-crimson">{error}</p>}
        </form>
      )}
    </section>
  );
}
