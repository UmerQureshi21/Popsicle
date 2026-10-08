import { describe, expect, it } from "vitest";
import { BOOKING_LINK, defaultLinkMessage, describeBooking, halfHours, minutesLabel, slotsByDay, timeZones } from "./booking";

describe("booking helpers", () => {
  it("labels times of day", () => {
    expect(minutesLabel(540)).toBe("9:00 AM");
    expect(minutesLabel(17 * 60 + 30)).toBe("5:30 PM");
    expect(minutesLabel(0)).toBe("12:00 AM");
    expect(minutesLabel(24 * 60)).toBe("12:00 AM (midnight)");
  });

  it("lists every half hour in a range", () => {
    expect(halfHours(540, 600)).toEqual([
      { value: 540, label: "9:00 AM" },
      { value: 570, label: "9:30 AM" },
      { value: 600, label: "10:00 AM" },
    ]);
    expect(halfHours()).toHaveLength(49);
  });

  it("puts your time zone first, once", () => {
    const zones = timeZones("America/Toronto");
    expect(zones[0]).toBe("America/Toronto");
    expect(zones.filter((z) => z === "America/Toronto")).toHaveLength(1);
    expect(zones).toContain("Europe/London");
  });

  it("works where the browser can't list time zones", () => {
    const original = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf")!;
    Object.defineProperty(Intl, "supportedValuesOf", { value: undefined, configurable: true });
    try {
      expect(timeZones("America/Toronto")).toEqual(["America/Toronto"]);
    } finally {
      Object.defineProperty(Intl, "supportedValuesOf", original);
    }
    expect(timeZones("UTC").length).toBeGreaterThan(1);
  });

  it("groups open times by day in the visitor's time zone", () => {
    const slots = ["2030-10-08T13:00:00Z", "2030-10-08T13:30:00Z", "2030-10-09T03:30:00Z"];
    const toronto = slotsByDay(slots, "America/Toronto");
    expect(toronto.map((d) => d.key)).toEqual(["2030-10-08"]);
    expect(toronto[0].label).toBe("Tuesday, October 8");
    expect(toronto[0].slots.map((s) => s.label)).toEqual(["9:00 AM", "9:30 AM", "11:30 PM"]);
    const tokyo = slotsByDay(slots, "Asia/Tokyo");
    expect(tokyo.map((d) => d.key)).toEqual(["2030-10-08", "2030-10-09"]);
    expect(tokyo[1].slots).toEqual([{ at: "2030-10-09T03:30:00Z", label: "12:30 PM" }]);
  });

  it("describes a booking", () => {
    expect(describeBooking("2030-10-08T14:00:00Z", "2030-10-08T14:30:00Z", "America/Toronto")).toBe(
      "Tuesday, October 8, 10:00 AM – 10:30 AM EDT",
    );
    expect(describeBooking("2030-10-08T14:00:00Z", null, "America/Toronto")).toBe("Tuesday, October 8 at 10:00 AM");
  });

  it("starts the email with the link in it", () => {
    expect(defaultLinkMessage("Jo")).toContain(`Hi Jo,`);
    expect(defaultLinkMessage("Jo")).toContain(BOOKING_LINK);
  });
});
