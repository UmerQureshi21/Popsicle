"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { api, type ConversationSummary } from "@/lib/api";
import { BOOKING_LINK, defaultLinkMessage } from "@/lib/booking";
import { firstName } from "@/lib/meet";
import { Button, Modal } from "@/components/ui";

const inputClass =
  "mt-1 block w-full rounded-xl border border-steel/30 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";

/** Email someone their own link to pick a time, as a reply in your conversation. */
export default function SendBookingLink({ person, onClose, onSent }: { person: ConversationSummary; onClose: () => void; onSent: () => void }) {
  const name = firstName(person.full_name, person.email);
  const [message, setMessage] = useState(() => defaultLinkMessage(name));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/conversations/${person.contact_id}/booking-link`, { message });
      onSent();
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
          <CalendarCheck className="size-5 text-crimson" /> Booking link for {name}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={sending || !message.trim()}>
            <CalendarCheck className="size-4" /> {sending ? "Sending…" : "Send booking link"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-6">
        <p className="text-sm text-steel">
          {name} picks a time that suits them inside your booking hours. Popsicle then sets up the Google Meet call and sends them the invite.
        </p>
        <label className="block">
          <span className="text-sm font-medium text-ink">Email to {person.email}</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={8} className={`${inputClass} resize-y leading-relaxed`} />
          <span className="mt-1 block text-xs text-steel">
            <code className="rounded bg-cloud px-1 text-ink">{BOOKING_LINK}</code> becomes their link. It’s sent as a reply in your conversation.
          </span>
        </label>
        {error && <p className="text-sm text-crimson">{error}</p>}
      </div>
    </Modal>
  );
}
