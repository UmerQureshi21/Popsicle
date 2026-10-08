"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { API_URL, api, type BookingSettings } from "@/lib/api";
import { WEEKDAYS, halfHours, timeZones } from "@/lib/booking";
import { timeZone } from "@/lib/meet";
import { Button, Modal } from "@/components/ui";
import Select from "@/components/Select";

const inputClass =
  "mt-1 block w-full rounded-xl border border-steel/30 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10";
const NOTICE = [0, 1, 2, 4, 12, 24, 48, 72].map((h) => ({ value: h, label: h === 0 ? "No notice" : `${h} hour${h === 1 ? "" : "s"}` }));
const AHEAD = [7, 14, 21, 30, 60].map((d) => ({ value: d, label: `${d} days` }));

/** The "Booking hours" button at the top of the Inbox, and the settings it opens. */
export default function BookingHours() {
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get<BookingSettings>("/api/booking/settings").then(setSettings, () => {});
  }, []);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!settings}>
        <CalendarClock className="size-4" /> Booking hours
        {settings && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${settings.enabled ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-cloud text-steel"}`}>
            {settings.enabled ? "On" : "Off"}
          </span>
        )}
      </Button>
      {open && settings && (
        <BookingHoursForm
          initial={settings}
          onClose={() => setOpen(false)}
          onSaved={(s) => {
            setSettings(s);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function BookingHoursForm({ initial, onClose, onSaved }: { initial: BookingSettings; onClose: () => void; onSaved: (s: BookingSettings) => void }) {
  // A first-time setup starts in your own time zone.
  const [s, setS] = useState<BookingSettings>(() => (initial.enabled || initial.host_name ? initial : { ...initial, time_zone: timeZone() }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BookingSettings>(k: K, v: BookingSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const toggleDay = (d: number) => set("weekdays", s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { can_check_calendar, ...body } = s;
      void can_check_calendar;
      onSaved(await api.put<BookingSettings>("/api/booking/settings", body));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="size-5 text-crimson" /> Booking hours
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-6">
        <p className="text-sm text-steel">
          Put <code className="rounded bg-cloud px-1 text-ink">{"{{booking_link}}"}</code> in an email, or use <span className="font-medium text-ink">Booking link</span> in a
          conversation. Each person gets their own page to pick a 30-minute time, and it becomes a Google Meet call.
        </p>

        {initial.can_check_calendar === false && (
          <p className="rounded-xl bg-crimson/5 px-4 py-3 text-sm text-crimson">
            Popsicle can’t see your Google Calendar yet, so it can’t tell when you’re busy.{" "}
            <a href={`${API_URL}/api/gmail/connect?next=/conversations`} className="font-semibold underline underline-offset-2">
              Reconnect Gmail
            </a>{" "}
            and allow calendar events.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-4 accent-crimson" />
          Take bookings
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Your name</span>
          <input value={s.host_name} onChange={(e) => set("host_name", e.target.value)} placeholder="Shown on the booking page" className={inputClass} />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink">Days</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, d) => (
              <button
                key={label}
                type="button"
                aria-pressed={s.weekdays.includes(d)}
                onClick={() => toggleDay(d)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${s.weekdays.includes(d) ? "bg-night text-white" : "bg-cloud text-steel hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-sm font-medium text-ink">From</span>
            <Select ariaLabel="From" value={s.day_start} onChange={(v) => set("day_start", v)} options={halfHours(0, 23 * 60 + 30)} className="mt-1 w-full" />
          </div>
          <div>
            <span className="text-sm font-medium text-ink">Until</span>
            <Select ariaLabel="Until" value={s.day_end} onChange={(v) => set("day_end", v)} options={halfHours(30, 24 * 60)} className="mt-1 w-full" />
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink">Time zone</span>
          <select value={s.time_zone} onChange={(e) => set("time_zone", e.target.value)} className={inputClass}>
            {timeZones(s.time_zone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-sm font-medium text-ink">Notice</span>
            <Select ariaLabel="Notice" value={s.notice_hours} onChange={(v) => set("notice_hours", v)} options={NOTICE} className="mt-1 w-full" />
          </div>
          <div>
            <span className="text-sm font-medium text-ink">Up to</span>
            <Select ariaLabel="Up to" value={s.days_ahead} onChange={(v) => set("days_ahead", v)} options={AHEAD} className="mt-1 w-full" />
          </div>
        </div>
        <p className="-mt-3 text-xs text-steel">Anything on your Google Calendar is left out automatically.</p>

        {error && <p className="text-sm text-crimson">{error}</p>}
      </div>
    </Modal>
  );
}
