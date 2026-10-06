import { expect, it } from "vitest";
import { DEFAULT_LOCATION, LOCATIONS, locationById } from "./locations";

it("the GTA covers Toronto and the surrounding cities, all in Canada", () => {
  const gta = locationById("gta");
  expect(gta.filters).toContainEqual({ city: "Toronto", country: "CA" });
  expect(gta.filters).toContainEqual({ city: "Mississauga", country: "CA" });
  expect(gta.filters?.every((f) => f.country === "CA")).toBe(true);
});

it("looks up locations by id, defaulting to the first", () => {
  expect(locationById("canada").filters).toEqual([{ country: "CA" }]);
  expect(locationById("any").filters).toBeNull();
  expect(locationById("mars")).toBe(LOCATIONS[0]);
  expect(DEFAULT_LOCATION).toBe("gta");
});
