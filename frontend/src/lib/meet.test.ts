import { describe, expect, it } from "vitest";
import { combine, defaultMessage, defaultTitle, describeWhen, firstName, LINK, nextWeekday, timeSlots, timeZone, toDateInput } from "./meet";

describe("meet helpers", () => {
  it("offers 15-minute slots from 7 AM to 9 PM", () => {
    const slots = timeSlots();
    expect(slots).toHaveLength(57);
    expect(slots[0].value).toBe("07:00");
    expect(slots[1].value).toBe("07:15");
    expect(slots.at(-1)?.value).toBe("21:00");
    expect(slots[8].label).toMatch(/9:00/);
  });

  it("the next weekday skips the weekend", () => {
    expect(toDateInput(nextWeekday(new Date(2026, 9, 6, 22)))).toBe("2026-10-07"); // Tue -> Wed
    expect(toDateInput(nextWeekday(new Date(2026, 9, 9)))).toBe("2026-10-12"); // Fri -> Mon
    expect(toDateInput(nextWeekday(new Date(2026, 9, 10)))).toBe("2026-10-12"); // Sat -> Mon
    expect(nextWeekday().getTime()).toBeGreaterThan(Date.now());
  });

  it("combines a date and a time", () => {
    expect(combine("2026-10-07", "09:30")).toEqual(new Date(2026, 9, 7, 9, 30));
    expect(combine("", "09:30")).toBeNull();
    expect(combine("2026-10-07", "9")).toBeNull();
  });

  it("describes when, with the timezone", () => {
    const text = describeWhen(new Date(2026, 9, 7, 9, 0));
    expect(text).toMatch(/^Wednesday, October 7 at 9:00\sAM \S+/);
    expect(timeZone()).toBeTruthy();
  });

  it("finds a first name", () => {
    expect(firstName("Douglas Quan", "dq@harvey.ai")).toBe("Douglas");
    expect(firstName("  ", "jane.doe@stripe.com")).toBe("Jane");
    expect(firstName(null, "sam@stripe.com")).toBe("Sam");
  });

  it("writes a friendly default", () => {
    expect(defaultTitle("Douglas")).toBe("Coffee chat with Douglas");
    const msg = defaultMessage("Douglas", new Date(2026, 9, 7, 9, 0));
    expect(msg).toContain("Hi Douglas,");
    expect(msg).toContain("for Wednesday, October 7 at 9:00");
    expect(msg).toContain(LINK);
    expect(defaultMessage("Douglas", null)).toContain("Here’s the Google Meet link:");
  });
});
