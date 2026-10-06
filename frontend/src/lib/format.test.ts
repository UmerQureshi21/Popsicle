import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate, formatDateTime, initials, timeAgo } from "./format";

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 kB"],
    [5 * 1024 * 1024 + 100_000, "5.1 MB"],
  ])("%d -> %s", (n, out) => expect(formatBytes(n)).toBe(out));
});

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("formatDate drops the year for this year and keeps it otherwise", () => {
    expect(formatDate("2026-11-02")).toBe(new Date(2026, 10, 2).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(formatDate("2024-03-01T12:00:00Z")).toContain("2024");
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("formatDate reads a plain calendar date as local time", () => {
    expect(formatDate("2026-01-01")).toBe(new Date(2026, 0, 1).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });

  it("formatDateTime", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("2026-10-01T12:00:00Z")).toBe(
      new Date("2026-10-01T12:00:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    );
  });

  it("timeAgo", () => {
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo(ago(10))).toBe("just now");
    expect(timeAgo(ago(5 * 60))).toBe("5m ago");
    expect(timeAgo(ago(3 * 3600))).toBe("3h ago");
    expect(timeAgo(ago(4 * 86400))).toBe("4d ago");
    expect(timeAgo("2026-01-15T12:00:00Z")).toBe(formatDate("2026-01-15T12:00:00Z"));
  });
});

describe("initials", () => {
  it.each([
    ["Jane Doe", "JD"],
    ["Cher", "C"],
    ["jane.doe@stripe.com", "JD"],
    ["jane@stripe.com", "J"],
    ["Jane Q Public", "JP"],
    ["", "?"],
  ])("%s -> %s", (input, out) => expect(initials(input)).toBe(out));
});
