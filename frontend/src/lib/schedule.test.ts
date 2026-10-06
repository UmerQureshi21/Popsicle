import { afterEach, describe, expect, it, vi } from "vitest";
import { quickPicks, timezoneName, toLocalInput } from "./schedule";

afterEach(() => vi.useRealTimers());

describe("quickPicks", () => {
  it("offers tomorrow, next Tuesday and next Thursday at 9 AM", () => {
    const sunday = new Date(2026, 9, 4, 22, 30); // Sun Oct 4, 10:30 PM
    const picks = quickPicks(sunday);
    expect(picks.map((p) => [p.at.getDate(), p.at.getHours(), p.at.getMinutes()])).toEqual([
      [5, 9, 0], // Mon (tomorrow)
      [6, 9, 0], // Tue
      [8, 9, 0], // Thu
    ]);
    expect(picks[0].label).toMatch(/^Tomorrow, Mon, Oct 5 · 9:00/);
    expect(picks[1].label).toMatch(/^Tue, Oct 6 · 9:00/);
  });

  it("doesn't repeat a day when tomorrow is already Tuesday", () => {
    const monday = new Date(2026, 9, 5, 18, 0);
    const picks = quickPicks(monday);
    expect(picks.map((p) => p.at.getDate())).toEqual([6, 8]); // Tue (tomorrow), Thu
    expect(picks[0].label).toMatch(/^Tomorrow, Tue/);
  });

  it("on a Tuesday, next Tuesday means the week after", () => {
    const tuesday = new Date(2026, 9, 6, 8, 0);
    expect(quickPicks(tuesday).map((p) => p.at.getDate())).toEqual([7, 8, 13]); // Wed (tomorrow), Thu, next Tue
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 22, 30));
    expect(quickPicks()[0].at.getDate()).toBe(5);
  });
});

it("toLocalInput formats for a datetime-local input", () => {
  expect(toLocalInput(new Date(2026, 0, 2, 3, 4))).toBe("2026-01-02T03:04");
});

it("timezoneName gives a short zone name", () => {
  expect(timezoneName(new Date(2026, 9, 6))).toMatch(/\S+/);
});
