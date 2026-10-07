"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clock, Loader2, MailCheck, Paperclip, Send } from "lucide-react";
import {
  API_URL,
  api,
  type Attachment,
  type CampaignDetail,
  type CampaignDraft,
  type GmailStatus,
  type Preview,
  type Verification,
} from "@/lib/api";
import { creditsChanged, useHunterStatus } from "@/lib/credits";
import { formatDate, formatDateTime } from "@/lib/format";
import { VERIFY_PIECE, inPieces } from "@/lib/pieces";
import { quickPicks, timezoneName, toLocalInput } from "@/lib/schedule";
import { Avatar, Button, Modal, Popover, StatusBadge } from "@/components/ui";

// What each Hunter verdict means for the person reading the review screen.
const VERDICTS: Record<Verification["status"], { label: string; tone: string; why: string }> = {
  valid: { label: "verified", tone: "bg-emerald-50 text-emerald-700", why: "Hunter confirmed this address exists." },
  invalid: { label: "doesn't exist", tone: "bg-crimson/10 text-crimson", why: "Hunter says this address doesn't exist." },
  accept_all: {
    label: "risky",
    tone: "bg-cloud text-ink/70",
    why: "The company's mail server accepts every address, so Hunter can't confirm this one.",
  },
  webmail: { label: "risky", tone: "bg-cloud text-ink/70", why: "A personal webmail address, so Hunter can't confirm it." },
  disposable: { label: "risky", tone: "bg-cloud text-ink/70", why: "A throwaway address that may not be read." },
  unknown: { label: "risky", tone: "bg-cloud text-ink/70", why: "Hunter couldn't confirm whether this address exists." },
  pending: { label: "checking", tone: "bg-cloud text-steel", why: "Hunter is still checking this address." },
};

export function VerificationBadge({ verification }: { verification?: Verification | null }) {
  if (!verification) return null;
  const v = VERDICTS[verification.status] ?? VERDICTS.unknown;
  return (
    <span title={v.why} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${v.tone}`}>
      {v.label}
    </span>
  );
}

type Props = {
  draft: CampaignDraft;
  attachments: Attachment[];
  gmail: GmailStatus | null;
  onClose: () => void;
  onSent: (campaign: CampaignDetail) => void;
};

export default function PreviewModal({ draft, attachments, gmail, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [version, setVersion] = useState(0); // bumped to re-render the preview after verifying
  const [verifying, setVerifying] = useState(false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const hunter = useHunterStatus();

  useEffect(() => {
    api.post<Preview>("/api/campaigns/preview", draft).then(setPreview, (e) => setError(e.message));
  }, [draft, version]);

  // Ready recipients Hunter hasn't checked in the last 30 days.
  const unchecked = preview?.items.filter((it) => it.status === "ready" && !it.verification).map((it) => it.to_email) ?? [];
  const checked = preview?.items.filter((it) => it.verification) ?? [];
  const verified = checked.filter((it) => it.verification!.status === "valid").length;
  const risky = checked.filter((it) => !["valid", "invalid"].includes(it.verification!.status)).length;

  const verify = async () => {
    setVerifying(true);
    setVerifyNote(null);
    try {
      // A few at a time, so no request runs long; verdicts already back are kept if one fails.
      let pending = 0;
      for (const piece of inPieces(unchecked, VERIFY_PIECE)) {
        const res = await api.post<{ results: Verification[] }>("/api/people-search/verify", { emails: piece });
        pending += res.results.filter((r) => r.status === "pending").length;
      }
      if (pending) setVerifyNote(`Hunter is still checking ${pending} address${pending === 1 ? "" : "es"}. Try again in a minute.`);
      setVersion((v) => v + 1);
    } catch (e) {
      setVerifyNote((e as Error).message);
    } finally {
      setVerifying(false);
      creditsChanged();
    }
  };

  const item = preview?.items[selected];
  const canSend = !!preview && preview.ready > 0 && preview.invalid === 0 && !!gmail?.connected && !sending;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customTime, setCustomTime] = useState(() => toLocalInput(quickPicks()[0].at));

  /** Send now, or (with `at`) schedule the batch to start then. */
  const send = async (at?: Date) => {
    setSending(true);
    setError(null);
    setScheduleOpen(false);
    try {
      onSent(await api.post<CampaignDetail>("/api/campaigns", at ? { ...draft, scheduled_for: at.toISOString() } : draft));
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  const custom = customTime ? new Date(customTime) : null;
  const customOk = !!custom && !Number.isNaN(custom.getTime()) && custom > new Date();

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Review before sending"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-steel">
            {preview ? (
              <>
                <span className="font-semibold text-ink">{preview.ready}</span> ready
                {preview.already_sent > 0 && <> · {preview.already_sent} already emailed (skipped)</>}
                {preview.undeliverable > 0 && (
                  <span className="text-crimson">
                    {" "}
                    · {preview.undeliverable} {preview.undeliverable === 1 ? "doesn't" : "don't"} exist (skipped)
                  </span>
                )}
                {preview.invalid > 0 && <span className="text-crimson"> · {preview.invalid} need fixing</span>}
                <> · ~{Math.round(draft.delay_seconds)}s between emails</>
              </>
            ) : (
              "Rendering…"
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onClose}>Back to editing</Button>
            <div className="relative">
              <Button onClick={() => setScheduleOpen(!scheduleOpen)} disabled={!canSend} aria-expanded={scheduleOpen}>
                <CalendarClock className="size-4" /> Schedule
              </Button>
              <Popover open={scheduleOpen} onClose={() => setScheduleOpen(false)} className="right-0 bottom-full mb-2 w-80 p-3">
                <p className="px-1 pb-2 text-sm font-semibold text-ink">Send later</p>
                <p className="px-1 pb-3 text-xs text-steel">Morning emails get read and answered more. Times are in your timezone ({timezoneName()}).</p>
                <ul className="space-y-1">
                  {quickPicks().map((p) => (
                    <li key={p.at.getTime()}>
                      <button
                        onClick={() => send(p.at)}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-cloud"
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-cloud pt-3">
                  <label className="block px-1 text-xs font-medium text-ink">
                    Pick a time
                    <input
                      type="datetime-local"
                      value={customTime}
                      min={toLocalInput(new Date())}
                      onChange={(e) => setCustomTime(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-steel/30 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-scarlet"
                    />
                  </label>
                  <Button variant="primary" className="mt-2 w-full" disabled={!customOk} onClick={() => custom && send(custom)}>
                    Schedule {preview?.ready ?? ""} email{preview?.ready === 1 ? "" : "s"}
                  </Button>
                  {customTime && !customOk && <p className="mt-1.5 px-1 text-xs text-crimson">Pick a time in the future.</p>}
                </div>
              </Popover>
            </div>
            <Button variant="primary" onClick={() => send()} disabled={!canSend}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send {preview?.ready ?? ""} email{preview?.ready === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      }
    >
      {gmail && !gmail.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-crimson/15 bg-crimson/5 px-4 py-3 text-sm text-crimson sm:px-6">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {gmail.credentials_file_present
              ? "Connect your Gmail account before sending."
              : "Gmail isn't set up yet: add backend/credentials.json (see README), then connect."}
          </span>
          {gmail.credentials_file_present && (
            <a href={`${API_URL}/api/gmail/connect`} className="font-semibold underline underline-offset-2">
              Connect Gmail
            </a>
          )}
        </div>
      )}
      {error && <div className="border-b border-crimson/15 bg-crimson/5 px-4 py-3 text-sm text-crimson sm:px-6">{error}</div>}
      {preview && preview.sends_later > 0 && (
        <div className="flex items-start gap-2 border-b border-cloud bg-cloud/60 px-4 py-3 text-sm text-ink sm:px-6">
          <Clock className="mt-0.5 size-4 shrink-0 text-steel" />
          <span>
            Your daily limit is {preview.quota.daily_limit} emails ({preview.quota.remaining} left right now).{" "}
            {preview.sends_now > 0 ? `${preview.sends_now} will send now; the other ` : "All "}
            {preview.sends_later} will wait and go out automatically from about{" "}
            {formatDateTime(preview.later_from ?? preview.quota.next_slot_at)}.
          </span>
        </div>
      )}

      {preview && hunter?.configured && (unchecked.length > 0 || checked.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cloud px-4 py-3 text-sm sm:px-6">
          <span className="flex min-w-0 items-start gap-2 text-ink">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-steel" />
            <span>
              {unchecked.length > 0 ? (
                <>
                  Check {unchecked.length} address{unchecked.length === 1 ? "" : "es"} exist before sending, so bounces
                  don’t hurt your Gmail.
                  {hunter.verifications_remaining != null && (
                    <span className="text-steel">
                      {" "}
                      Uses {Math.min(unchecked.length, 100)} of your {hunter.verifications_remaining} Hunter verifications
                      left this month.
                    </span>
                  )}
                </>
              ) : (
                <>
                  Addresses checked: {verified} verified
                  {risky > 0 && <> · {risky} risky</>}
                  {preview.undeliverable > 0 && (
                    <span className="text-crimson">
                      {" "}
                      · {preview.undeliverable} {preview.undeliverable === 1 ? "doesn’t" : "don’t"} exist
                    </span>
                  )}
                </>
              )}
              {verifyNote && <span className="mt-1 block text-crimson">{verifyNote}</span>}
            </span>
          </span>
          {unchecked.length > 0 && (
            <Button className="px-3 py-1.5" onClick={verify} disabled={verifying}>
              {verifying && <Loader2 className="size-4 animate-spin" />}
              Verify {Math.min(unchecked.length, 100)}
            </Button>
          )}
        </div>
      )}

      {!preview ? (
        <div className="grid h-80 place-items-center text-steel">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <div className="grid min-h-[28rem] md:grid-cols-[260px_1fr]">
          <ul className="hidden max-h-[60vh] overflow-y-auto border-r border-cloud p-2 md:block">
            {preview.items.map((it, i) => (
              <li key={i}>
                <button
                  onClick={() => setSelected(i)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${
                    i === selected ? "bg-cloud" : "hover:bg-cloud/60"
                  }`}
                >
                  <Avatar name={it.values.full_name || it.to_email || "?"} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {it.values.full_name || it.to_email || "(no email)"}
                    </span>
                    <span className="block truncate text-xs text-steel">{it.to_email}</span>
                  </span>
                  {it.status !== "ready" ? <StatusBadge status={it.status} /> : <VerificationBadge verification={it.verification} />}
                </button>
              </li>
            ))}
          </ul>

          {item && (
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-cloud px-4 py-3 text-sm sm:px-6">
                <div className="min-w-0">
                  {/* On phones the recipient list is hidden, so name who this one is for */}
                  {item.values.full_name && <p className="truncate font-semibold text-ink md:hidden">{item.values.full_name}</p>}
                  <p className="truncate">
                    <span className="text-steel">To </span>
                    <span className="font-medium text-ink">{item.to_email}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-steel">
                  <span className="mr-1 text-xs">
                    {selected + 1} / {preview.items.length}
                  </span>
                  <button
                    className="rounded-lg p-1 hover:bg-cloud disabled:opacity-30"
                    disabled={selected === 0}
                    onClick={() => setSelected(selected - 1)}
                    aria-label="Previous"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    className="rounded-lg p-1 hover:bg-cloud disabled:opacity-30"
                    disabled={selected === preview.items.length - 1}
                    onClick={() => setSelected(selected + 1)}
                    aria-label="Next"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
              {item.status === "invalid" && (
                <div className="mx-4 mt-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson sm:mx-6">{item.issues.join(" · ")}</div>
              )}
              {item.status === "undeliverable" && (
                <div className="mx-4 mt-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson sm:mx-6">
                  Hunter says this address doesn’t exist (checked {formatDate(item.verification?.checked_at)}). It’ll be
                  skipped, so it doesn’t bounce.
                </div>
              )}
              {item.status === "ready" && item.verification && item.verification.status !== "valid" && (
                <div className="mx-4 mt-4 rounded-xl bg-cloud px-4 py-2.5 text-sm text-ink/80 sm:mx-6">
                  {VERDICTS[item.verification.status]?.why ?? VERDICTS.unknown.why} It’ll still be sent.
                </div>
              )}
              {item.status === "already_sent" && (
                <div className="mx-4 mt-4 rounded-xl bg-cloud px-4 py-2.5 text-sm text-ink/80 sm:mx-6">
                  You already emailed this person on {formatDate(item.last_sent_at)}. They’ll be skipped.
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <h3 className="mb-4 text-xl font-semibold text-ink">{item.subject}</h3>
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink/90">{item.body}</div>
                {attachments.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {attachments.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 rounded-lg bg-cloud px-2.5 py-1.5 text-xs text-ink">
                        <Paperclip className="size-3.5 text-steel" />
                        {a.filename}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
