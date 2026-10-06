import type { FoundPerson } from "./api";

type Row = Record<string, string>;

/**
 * Turn people found on Hunter into recipient rows. Each row fills whichever variables match
 * what Hunter knows, and a `role` variable is added for job titles if there isn't one already.
 */
export function peopleToRows(people: FoundPerson[], variables: string[]): { variables: string[]; rows: Row[] } {
  const hasTitleColumn = ["role", "title", "position"].some((v) => variables.includes(v));
  const vars = people.some((p) => p.position) && !hasTitleColumn ? [...variables, "role"] : variables;
  const rows = people.map((p) => {
    const known: Record<string, string | null> = {
      full_name: p.full_name ?? p.first_name,
      name: p.full_name ?? p.first_name,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      role: p.position,
      title: p.position,
      position: p.position,
      department: p.department,
      seniority: p.seniority,
      linkedin: p.linkedin_url,
      linkedin_url: p.linkedin_url,
    };
    return Object.fromEntries(vars.map((v) => [v, known[v] ?? ""]));
  });
  return { variables: vars, rows };
}

// ---- Handing people from the Find people page to Compose ----

const HANDOFF_KEY = "popsicle:recipients-handoff";

export type Handoff = {
  company: string | null;
  people: FoundPerson[];
  /** "replace" starts a fresh batch with these people; "append" adds them to the current one. */
  mode?: "replace" | "append";
};

export function saveHandoff(handoff: Handoff) {
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {}
}

/** Read without removing; call clearHandoff once it has been applied. */
export function readHandoff(): Handoff | null {
  try {
    const raw = localStorage.getItem(HANDOFF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearHandoff() {
  try {
    localStorage.removeItem(HANDOFF_KEY);
  } catch {}
}
