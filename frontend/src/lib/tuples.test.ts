import { describe, expect, it } from "vitest";
import { derivedVariables, normalizeVariableName, parseTuples, placeholdersIn, validateRows } from "./tuples";

const values = (text: string) => parseTuples(text).map((r) => r.values);

describe("parseTuples", () => {
  it("returns nothing for blank input", () => {
    expect(parseTuples("   \n ")).toEqual([]);
  });

  it("reads one Python tuple per line, with line numbers", () => {
    expect(parseTuples('("Jane Doe", "jane@stripe.com")\n\n("Sam", \'sam@x.com\')')).toEqual([
      { values: ["Jane Doe", "jane@stripe.com"], line: 1 },
      { values: ["Sam", "sam@x.com"], line: 3 },
    ]);
  });

  it("reads a whole Python list of tuples", () => {
    expect(values('[("Jane", "j@x.com"), ("Sam", "s@x.com")]')).toEqual([
      ["Jane", "j@x.com"],
      ["Sam", "s@x.com"],
    ]);
  });

  it("reads JSON arrays, turning null into an empty value", () => {
    expect(parseTuples('[["Jane", "j@x.com"], ["Sam", null, 3]]')).toEqual([
      { values: ["Jane", "j@x.com"], line: 1 },
      { values: ["Sam", "", "3"], line: 2 },
    ]);
  });

  it("falls back to tuples when JSON-looking text doesn't parse", () => {
    // Not JSON and no parens, so it's read as one comma-separated line.
    expect(values('[["Jane", "j@x.com"],')).toEqual([['[["Jane"', "j@x.com]"]]);
  });

  it("keeps apostrophes inside names and parens inside quotes", () => {
    expect(values(`(O'Brien, "a (b) c", x@y.com)`)).toEqual([["O'Brien", "a (b) c", "x@y.com"]]);
  });

  it("handles escaped quotes", () => {
    expect(values('("Say \\"hi\\"", "a@b.com")')).toEqual([['Say "hi"', "a@b.com"]]);
  });

  it("ignores a trailing comma", () => {
    expect(values('("Jane", "j@x.com",)')).toEqual([["Jane", "j@x.com"]]);
  });

  it("keeps nested parens as text", () => {
    expect(values('("Jane (PM)", "j@x.com")')).toEqual([["Jane (PM)", "j@x.com"]]);
    expect(values("((a, b))")).toEqual([["(a", "b)"]]);
  });

  it("ignores a stray closing paren", () => {
    expect(values(') ("a", "b")')).toEqual([["a", "b"]]);
  });

  it("reads comma-separated lines", () => {
    expect(parseTuples("Jane Doe, jane@x.com\n\nSam, sam@x.com")).toEqual([
      { values: ["Jane Doe", "jane@x.com"], line: 1 },
      { values: ["Sam", "sam@x.com"], line: 3 },
    ]);
  });

  it("reads tab-separated lines pasted from a spreadsheet", () => {
    expect(values("Jane, Jr\tjane@x.com")).toEqual([["Jane, Jr", "jane@x.com"]]);
  });

  it("keeps a lone quote that doesn't start a value", () => {
    expect(values('Jane "JD" Doe, j@x.com')).toEqual([['Jane "JD" Doe', "j@x.com"]]);
  });
});

describe("validateRows", () => {
  it("keeps only the given variables, trimmed, and skips blank rows", () => {
    const rows: Record<string, string>[] = [{ email: " j@x.com ", full_name: "Jane", extra: "x" }, {}, { email: "  " }];
    expect(validateRows(rows, ["full_name", "email"])).toEqual([
      { line: 1, values: { full_name: "Jane", email: "j@x.com" }, error: null },
    ]);
  });

  it("flags missing and invalid emails", () => {
    const out = validateRows([{ full_name: "Jane" }, { email: "nope" }], ["full_name", "email"]);
    expect(out.map((r) => r.error)).toEqual(["missing email", '"nope" isn\'t a valid email']);
    expect(out.map((r) => r.line)).toEqual([1, 2]);
  });
});

describe("derivedVariables", () => {
  const B = "booking_link";

  it("adds first and last name when there's a full name", () => {
    expect(derivedVariables(["full_name", "email"], false)).toEqual(["first_name", "last_name", B]);
    expect(derivedVariables(["name", "first_name"], false)).toEqual(["last_name", B]);
    expect(derivedVariables(["name", "first_name", "last_name"], false)).toEqual([B]);
  });

  it("adds company when one is set and isn't already a variable", () => {
    expect(derivedVariables(["email"], true)).toEqual(["company", B]);
    expect(derivedVariables(["email", "company"], true)).toEqual([B]);
    expect(derivedVariables(["email"], false)).toEqual([B]);
  });

  it("always offers each person's booking link, unless it's a column already", () => {
    expect(derivedVariables(["email", B], false)).toEqual([]);
  });
});

describe("placeholdersIn", () => {
  it("lists placeholders once, lowercased", () => {
    expect(placeholdersIn("Hi {{ First_Name }}", "{{first_name}} at {{company}} {{1bad}}")).toEqual(["first_name", "company"]);
  });
});

describe("normalizeVariableName", () => {
  it.each([
    [" Job Title ", "job_title"],
    ["LinkedIn-URL!", "linkedin_url"],
    ["__a__", "a"],
    ["2nd role", "_2nd_role"],
    ["!!!", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeVariableName(input)).toBe(expected);
  });
});
