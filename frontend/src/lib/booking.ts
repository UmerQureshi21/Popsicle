/** Helpers for booking links: the hours you take bookings, and the times shown on the booking page. */

export const BOOKING_LINK = "{{booking_link}}";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "9:00 AM" for 540 minutes after midnight; 1440 is midnight at the end of the day. */
export function minutesLabel(m: number): string {
  const d = new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60);
  const label = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return m === 24 * 60 ? `${label} (midnight)` : label;
}

/** Every half hour of the day, for the start and end pickers. */
export function halfHours(from = 0, to = 24 * 60): { value: number; label: string }[] {
  const out = [];
  for (let m = from; m <= to; m += 30) out.push({ value: m, label: minutesLabel(m) });
  return out;
}

/** Every time zone the browser knows, with yours first. */
export function timeZones(mine: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [mine, ...all.filter((z) => z !== mine)];
}

export type SlotDay = { key: string; label: string; slots: { at: string; label: string }[] };

/** Open times grouped by day, in the visitor's own time zone. */
export function slotsByDay(slots: string[], timeZone?: string): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const at of slots) {
    const d = new Date(at);
    const key = d.toLocaleDateString("en-CA", { timeZone });
    if (!days.has(key)) {
      days.set(key, { key, label: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone }), slots: [] });
    }
    days.get(key)!.slots.push({ at, label: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone }) });
  }
  return [...days.values()];
}

/** "Tuesday, October 8, 10:00 – 10:30 AM EDT" in the visitor's time zone. */
export function describeBooking(startsAt: string, endsAt: string | null, timeZone?: string): string {
  const start = new Date(startsAt);
  const day = start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone });
  const from = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  if (!endsAt) return `${day} at ${from}`;
  const to = new Date(endsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone });
  return `${day}, ${from} – ${to}`;
}

export function defaultLinkMessage(name: string): string {
  return `Hi ${name},\n\nThanks for getting back to me! Grab whatever time works best for you here:\n\n${BOOKING_LINK}\n\nTalk soon,`;
}
