import { afterEach, describe, expect, it, vi } from "vitest";
import { person } from "@/test/fixtures";
import { clearHandoff, peopleToRows, readHandoff, saveHandoff } from "./people";

describe("peopleToRows", () => {
  it("fills matching variables and adds a role column for job titles", () => {
    const out = peopleToRows([person(), person({ email: "sam@x.com", full_name: null, first_name: "Sam", position: null })], ["full_name", "email"]);
    expect(out.variables).toEqual(["full_name", "email", "role"]);
    expect(out.rows).toEqual([
      { full_name: "Jane Doe", email: "jane@stripe.com", role: "Software Engineer" },
      { full_name: "Sam", email: "sam@x.com", role: "" },
    ]);
  });

  it("uses an existing title column instead of adding role", () => {
    const out = peopleToRows([person({ linkedin_url: "https://linkedin.com/in/jane" })], ["name", "email", "title", "linkedin", "team"]);
    expect(out.variables).toEqual(["name", "email", "title", "linkedin", "team"]);
    expect(out.rows[0]).toEqual({ name: "Jane Doe", email: "jane@stripe.com", title: "Software Engineer", linkedin: "https://linkedin.com/in/jane", team: "" });
  });

  it("doesn't add role when nobody has a title", () => {
    expect(peopleToRows([person({ position: null })], ["email"]).variables).toEqual(["email"]);
  });

  it("fills every field Hunter knows", () => {
    const vars = ["first_name", "last_name", "position", "department", "seniority", "linkedin_url"];
    expect(peopleToRows([person({ linkedin_url: "in/jane" })], vars).rows[0]).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      position: "Software Engineer",
      department: "it",
      seniority: "senior",
      linkedin_url: "in/jane",
    });
  });
});

describe("handoff", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves, reads (without removing) and clears", () => {
    expect(readHandoff()).toBeNull();
    saveHandoff({ company: "Stripe", people: [person()], mode: "append" });
    expect(readHandoff()).toEqual({ company: "Stripe", people: [person()], mode: "append" });
    expect(readHandoff()).not.toBeNull();
    clearHandoff();
    expect(readHandoff()).toBeNull();
  });

  it("treats unreadable saved data as nothing", () => {
    localStorage.setItem("popsicle:recipients-handoff", "{not json");
    expect(readHandoff()).toBeNull();
  });

  it("ignores storage errors", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveHandoff({ company: null, people: [] })).not.toThrow();
    expect(() => clearHandoff()).not.toThrow();
  });
});
