/** Helpers for setting up a Google Meet call: time slots, defaults, and the email text. */

export const LINK = "{{meet_link}}";
export const DURATIONS = [15, 20, 30, 45, 60] as const;

/** Every 15 minutes from 7:00 AM to 9:00 PM, as "HH:MM" with a readable label. */
export function timeSlots(): { value: string; label: string }[] {
  const out = [];
  for (let m = 7 * 60; m <= 21 * 60; m += 15) {
    const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
    const value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "yyyy-mm-dd" for a local date, as a date input wants it. */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The next weekday after `now` (Friday → Monday). */
export function nextWeekday(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/** A local date ("2026-10-07") and time ("09:30") as a moment. */
export function combine(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

export function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "Tuesday, October 7 at 9:00 AM EDT" */
export function describeWhen(at: Date): string {
  const day = at.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day} at ${time}`;
}

export function firstName(fullName: string | null, email: string): string {
  const name = fullName?.trim().split(/\s+/)[0];
  if (name) return name;
  const local = email.split("@")[0].split(/[._-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function defaultTitle(name: string): string {
  return `Coffee chat with ${name}`;
}

export function defaultMessage(name: string, at: Date | null): string {
  const when = at ? ` for ${describeWhen(at)}` : "";
  return `Hi ${name},\n\nThanks again, looking forward to our chat! Here’s the Google Meet link${when}:\n\n${LINK}\n\nTalk soon,`;
}
