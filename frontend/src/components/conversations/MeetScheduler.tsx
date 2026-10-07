"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import { API_URL, api, type ConversationSummary, type GmailStatus, type Meeting } from "@/lib/api";
import { DURATIONS, LINK, combine, defaultMessage, defaultTitle, firstName, nextWeekday, timeSlots, timeZone, toDateInput } from "@/lib/meet";
import { Button, Modal } from "@/components/ui";
import Select from "@/components/Select";

const SLOTS = timeSlots();
const inputClass =
  "mt-1 block w-full rounded-xl border border-steel/30 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";

/** Pick a time for a Google Meet call with someone, and email them the link. */
export default function MeetScheduler({
  person,
  gmail,
  onClose,
  onScheduled,
}: {
  person: ConversationSummary;
  gmail: GmailStatus | null;
  onClose: () => void;
  onScheduled: (m: Meeting) => void;
}) {
  const name = firstName(person.full_name, person.email);
  const [title, setTitle] = useState(defaultTitle(name));
  const [date, setDate] = useState(() => toDateInput(nextWeekday()));
  const [time, setTime] = useState("10:00");
  const [minutes, setMinutes] = useState<number>(30);
  const [invite, setInvite] = useState(true);
  // The message follows the chosen time until it's edited by hand.
  const [edited, setEdited] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const at = combine(date, time);
  const message = edited ?? defaultMessage(name, at);
  const inFuture = !!at && at > new Date();
  const allowed = !!gmail?.can_meet;

  const send = async () => {
    if (!at) return;
    setSending(true);
    setError(null);
    try {
      const meeting = await api.post<Meeting>(`/api/conversations/${person.contact_id}/meeting`, {
        title: title.trim(),
        starts_at: at.toISOString(),
        duration_minutes: minutes,
        time_zone: timeZone(),
        message,
        calendar_invite: invite,
      });
      onScheduled(meeting);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Video className="size-5 text-crimson" /> Google Meet with {name}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={!allowed || !inFuture || !title.trim() || sending}>
            <Video className="size-4" /> {sending ? "Sending…" : "Send Meet link"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-6">
        {!allowed && (
          <p className="rounded-xl bg-crimson/5 px-4 py-3 text-sm text-crimson">
            Popsicle needs permission to create Google Calendar events to make Meet links.{" "}
            <a href={`${API_URL}/api/gmail/connect?next=/conversations`} className="font-semibold underline underline-offset-2">
              Reconnect Gmail
            </a>{" "}
            and allow it.
          </p>
        )}

        <label className="block">
          <span className="text-sm font-medium text-ink">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-ink">Date</span>
            <input type="date" value={date} min={toDateInput(new Date())} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <div>
            <span className="text-sm font-medium text-ink">Time</span>
            <Select ariaLabel="Time" value={time} onChange={setTime} options={SLOTS} className="mt-1 w-full" />
          </div>
          <div>
            <span className="text-sm font-medium text-ink">Length</span>
            <Select
              ariaLabel="Length"
              value={minutes}
              onChange={setMinutes}
              options={DURATIONS.map((m) => ({ value: m, label: `${m} minutes` }))}
              className="mt-1 w-full"
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-steel">
          Your time ({timeZone()}). {date && !inFuture && <span className="text-crimson">Pick a time in the future.</span>}
        </p>

        <label className="block">
          <span className="text-sm font-medium text-ink">Email to {person.email}</span>
          <textarea
            value={message}
            onChange={(e) => setEdited(e.target.value)}
            rows={8}
            className={`${inputClass} resize-y leading-relaxed`}
          />
          <span className="mt-1 block text-xs text-steel">
            <code className="rounded bg-cloud px-1 text-ink">{LINK}</code> becomes the Meet link. It’s sent as a reply in your conversation.
            {edited !== null && (
              <button type="button" onClick={() => setEdited(null)} className="ml-2 font-medium text-ink underline underline-offset-2">
                Reset text
              </button>
            )}
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="size-4 accent-crimson" />
          Also send {name} a Google Calendar invite
        </label>

        {error && <p className="text-sm text-crimson">{error}</p>}
      </div>
    </Modal>
  );
}
