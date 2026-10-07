import { describe, expect, it } from "vitest";
import { DEFAULT_TITLES, ROLES, roleOf, roleTitles, titleLabel } from "./roles";

describe("job title presets", () => {
  it("the default covers software and data titles", () => {
    for (const t of ["software engineer", "full stack engineer", "data scientist", "data engineer", "machine learning engineer"]) {
      expect(DEFAULT_TITLES).toContain(t);
    }
  });

  it("leaves out bare words that would match unrelated jobs", () => {
    const all = ROLES.flatMap((r) => r.titles as readonly string[]);
    expect(all).not.toContain("developer");
    expect(all).not.toContain("engineer");
  });

  it("knows a preset from the titles, ignoring spacing and case", () => {
    expect(roleOf(DEFAULT_TITLES)?.id).toBe("software-data");
    expect(roleOf(roleTitles("recruiting").toUpperCase().replaceAll(", ", " ,  "))?.id).toBe("recruiting");
    expect(roleOf("software engineer")).toBeUndefined();
  });

  it("labels a search", () => {
    expect(titleLabel(DEFAULT_TITLES)).toBe("software & data roles");
    expect(titleLabel(roleTitles("recruiting"))).toBe("recruiters");
    expect(titleLabel(" barista ")).toBe("matching “barista”");
    expect(titleLabel("  ")).toBe("");
  });
});
