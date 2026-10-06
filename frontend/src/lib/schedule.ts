/** Times to suggest when scheduling a batch. Morning emails get read and answered more. */

export const SEND_HOUR = 9;

export type QuickPick = { label: string; at: Date };

function atNine(d: Date): Date {
  const x = new Date(d);
  x.setHours(SEND_HOUR, 0, 0, 0);
  return x;
}

/** The next given weekday (0 = Sunday) strictly after `from`'s date. */
function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + (((weekday - d.getDay() + 7) % 7) || 7));
  return d;
}

const dayAndTime = (d: Date) =>
  `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;

/** Tomorrow, next Tuesday and next Thursday at 9:00 AM local time, without duplicates. */
export function quickPicks(now = new Date()): QuickPick[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const candidates = [atNine(tomorrow), atNine(nextWeekday(now, 2)), atNine(nextWeekday(now, 4))];
  const seen = new Set<number>();
  return candidates
    .filter((d) => d > now && !seen.has(d.getTime()) && seen.add(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => ({ at: d, label: `${d.getTime() === atNine(tomorrow).getTime() ? "Tomorrow, " : ""}${dayAndTime(d)}` }));
}

/** A Date as the value of an <input type="datetime-local"> (local time, no seconds). */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The local timezone's short name, e.g. "EDT". */
export function timezoneName(at = new Date()): string {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
}
