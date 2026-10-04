/** Where people must be based. Hunter matches a person's own location, as city + ISO country code. */

export type LocationFilter = { city?: string; country?: string; state?: string; continent?: string };

const GTA_CITIES = [
  "Toronto",
  // Former cities people still list as their location
  "North York",
  "Scarborough",
  "Etobicoke",
  // Peel
  "Mississauga",
  "Brampton",
  "Caledon",
  // York
  "Markham",
  "Vaughan",
  "Richmond Hill",
  "Aurora",
  "Newmarket",
  "Stouffville",
  "King City",
  // Halton
  "Oakville",
  "Burlington",
  "Milton",
  "Halton Hills",
  // Durham
  "Pickering",
  "Ajax",
  "Whitby",
  "Oshawa",
  "Clarington",
];

export const LOCATIONS = [
  { id: "gta", label: "Greater Toronto Area", short: "in the GTA", filters: GTA_CITIES.map((city) => ({ city, country: "CA" })) },
  { id: "canada", label: "Anywhere in Canada", short: "in Canada", filters: [{ country: "CA" }] },
  { id: "any", label: "Anywhere", short: "", filters: null },
] as const satisfies readonly { id: string; label: string; short: string; filters: LocationFilter[] | null }[];

export type LocationId = (typeof LOCATIONS)[number]["id"];

export const DEFAULT_LOCATION: LocationId = "gta";

export function locationById(id: string) {
  return LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
}
