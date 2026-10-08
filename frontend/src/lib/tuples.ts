/**
 * Parsing the recipients box. Accepts any of:
 *   ("Jane Doe", "jane@stripe.com")            one tuple per line, Python style
 *   [("Jane Doe", "jane@stripe.com"), (...)]   a whole Python list
 *   [["Jane Doe", "jane@stripe.com"], ...]     JSON
 *   Jane Doe, jane@stripe.com                  plain comma-separated lines
 *   Jane Doe<TAB>jane@stripe.com               pasted from a spreadsheet
 */

export const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export type ParsedRow = { values: string[]; line: number };

function splitFields(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && i + 1 < s.length) {
        cur += s[++i];
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if ((ch === '"' || ch === "'") && cur.trim() === "") {
      quote = ch;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  // A trailing comma like ("a", "b",) shouldn't create an empty value.
  if (out.length > 1 && out[out.length - 1] === "" && s.trimEnd().endsWith(sep)) out.pop();
  return out;
}

/** Contents of each top-level (...) group, ignoring parens inside quotes. */
function parenGroups(text: string): { body: string; line: number }[] {
  const groups: { body: string; line: number }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = -1;
  let line = 1;
  let startLine = 1;
  let prev = ""; // last non-space character outside quotes
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    const before = prev;
    if (!/\s/.test(ch)) prev = ch;
    // Only a quote right after "(" or "," opens a string, so O'Brien stays intact.
    if ((ch === '"' || ch === "'") && ["", "(", ",", "["].includes(before)) quote = ch;
    else if (ch === "(") {
      if (depth++ === 0) {
        start = i + 1;
        startLine = line;
      }
    } else if (ch === ")" && depth > 0) {
      if (--depth === 0) groups.push({ body: text.slice(start, i), line: startLine });
    }
  }
  return groups;
}

export function parseTuples(text: string): ParsedRow[] {
  const t = text.trim();
  if (!t) return [];

  if (t.startsWith("[[")) {
    try {
      const data = JSON.parse(t);
      if (Array.isArray(data) && data.every(Array.isArray)) {
        return data.map((row: unknown[], i) => ({ values: row.map((v) => String(v ?? "").trim()), line: i + 1 }));
      }
    } catch {}
  }

  if (t.includes("(")) {
    return parenGroups(t).map((g) => ({ values: splitFields(g.body, ","), line: g.line }));
  }

  return text
    .split("\n")
    .map((l, i) => ({ l, line: i + 1 }))
    .filter(({ l }) => l.trim())
    .map(({ l, line }) => ({ values: splitFields(l, l.includes("\t") ? "\t" : ","), line }));
}

export type RecipientRow = {
  line: number;
  values: Record<string, string>;
  error: string | null;
};

/** Validate rows from the recipients table. Blank rows are skipped; `line` is the 1-based row number. */
export function validateRows(rows: Record<string, string>[], variables: string[]): RecipientRow[] {
  const out: RecipientRow[] = [];
  rows.forEach((row, i) => {
    const values: Record<string, string> = {};
    for (const v of variables) values[v] = (row[v] ?? "").trim();
    if (!Object.values(values).some(Boolean)) return;
    let error: string | null = null;
    if (!values.email) error = "missing email";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) error = `"${values.email}" isn't a valid email`;
    out.push({ line: i + 1, values, error });
  });
  return out;
}

/** Variables the template can use beyond the tuple ones (derived on the backend too). */
export function derivedVariables(variables: string[], hasCompany: boolean): string[] {
  const out: string[] = [];
  if (variables.includes("full_name") || variables.includes("name")) {
    if (!variables.includes("first_name")) out.push("first_name");
    if (!variables.includes("last_name")) out.push("last_name");
  }
  if (hasCompany && !variables.includes("company")) out.push("company");
  // Each person's own booking link, made when the batch is created (see Booking hours in the Inbox).
  if (!variables.includes("booking_link")) out.push("booking_link");
  return out;
}

export function placeholdersIn(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(PLACEHOLDER)) seen.add(m[1].toLowerCase());
  return [...seen];
}

export function normalizeVariableName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");
}
