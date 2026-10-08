import type { Page, Request } from "@playwright/test";

/** The made-up API address the e2e build points at (see playwright.config.ts). */
export const API = "http://api.e2e.test";

type Handler = (body: unknown, url: URL) => unknown | Promise<unknown>;

/** A canned response, or a function of the request that returns one. */
type Route = Handler | Reply | object | string | number | boolean | null;

export type Call = { method: string; path: string; body: unknown; url: URL };

/**
 * A fake backend answered from inside the browser. Routes are "METHOD /path" -> response (or a
 * function of the request body). Every request is recorded in `calls`; an unexpected one fails
 * with a 599 so a missing route is obvious.
 */
export const BOOKING_OFF = {
  enabled: false, host_name: "", time_zone: "America/Toronto", weekdays: [0, 1, 2, 3, 4],
  day_start: 540, day_end: 1020, notice_hours: 24, days_ahead: 14, can_check_calendar: true,
};

export class FakeApi {
  calls: Call[] = [];
  private routes = new Map<string, Handler>();

  constructor(routes: Record<string, Route> = {}) {
    this.set({
      "GET /api/auth/me": { user: null, auth_required: false },
      "GET /api/people-search/status": { configured: true, plan_name: "Free", credits_used: 10, credits_total: 50, credits_remaining: 40, reset_date: "2026-11-02", error: null },
      "GET /api/companies": companiesPage(() => []),
      "GET /api/companies/names": [],
      "GET /api/templates": [],
      "GET /api/gmail/status": { connected: true, email: "me@gmail.com", credentials_file_present: true },
      "GET /api/booking/settings": BOOKING_OFF,
      ...routes,
    });
  }

  set(routes: Record<string, Route>) {
    for (const [key, value] of Object.entries(routes)) {
      this.routes.set(key, typeof value === "function" ? (value as Handler) : () => value);
    }
    return this;
  }

  called(key: string): Call[] {
    const [method, path] = key.split(" ");
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  async install(page: Page) {
    // Hunter's logos go through Next's image optimiser; skip them so tests never reach the internet.
    await page.route("**/_next/image**", (route) => route.fulfill({ status: 404 }));
    await page.route(`${API}/**`, async (route) => {
      const req: Request = route.request();
      const url = new URL(req.url());
      const key = `${req.method()} ${url.pathname}`;
      let body: unknown;
      try {
        body = req.postDataJSON();
      } catch {
        body = req.postData();
      }
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(req) });
      this.calls.push({ method: req.method(), path: url.pathname, body, url });
      const handler = this.routes.get(key);
      if (!handler) return route.fulfill({ status: 599, headers: cors(req), json: { detail: `No fake for ${key}` } });
      const result = await handler(body, url);
      if (result instanceof Reply) return route.fulfill({ status: result.status, headers: cors(req), json: result.body });
      return route.fulfill({ status: 200, headers: cors(req), json: result });
    });
    return this;
  }
}

/** A non-200 answer: `new Reply(401, { detail: "..." })`. */
export class Reply {
  constructor(
    public status: number,
    public body: unknown = null,
  ) {}
}

function cors(req: Request) {
  return {
    "access-control-allow-origin": req.headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE",
  };
}

export const person = (overrides: Record<string, unknown> = {}) => ({
  email: "jane@stripe.com",
  first_name: "Jane",
  last_name: "Doe",
  full_name: "Jane Doe",
  position: "Software Engineer",
  department: "it",
  seniority: "senior",
  confidence: 96,
  verification_status: "valid",
  linkedin_url: null,
  already_emailed_at: null,
  ...overrides,
});

/** Answers like the backend's lists: a page at a time (?limit=&offset=). */
export function pageOf<T>(items: T[], url: URL) {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const end = offset + Number(url.searchParams.get("limit") ?? 30);
  return { items: items.slice(offset, end), total: items.length, next_offset: end < items.length ? end : null };
}

type Status = "not_started" | "emailed" | "replied" | "not_interested";

/** GET /api/companies over `list()`, with ?status= and ?q=, and the counts the tabs show. */
export function companiesPage(list: () => { name: string; domain: string | null; status: string }[]): Handler {
  return (_body, url) => {
    const q = url.searchParams.get("q")?.toLowerCase();
    const status = url.searchParams.get("status");
    const matching = list().filter((c) => !q || c.name.toLowerCase().includes(q) || c.domain?.includes(q));
    const counts: Record<Status, number> = { not_started: 0, emailed: 0, replied: 0, not_interested: 0 };
    matching.forEach((c) => counts[c.status as Status]++);
    return {
      ...pageOf(status ? matching.filter((c) => c.status === status) : matching, url),
      counts, all: matching.length, missing_domains: matching.filter((c) => !c.domain).length,
    };
  };
}

/** GET /api/conversations over `people`, with ?filter= and ?q=, and the tab counts. */
export function conversationsPage(people: { replied: boolean; full_name: string | null; email: string }[]): Handler {
  return (_body, url) => {
    const q = url.searchParams.get("q")?.toLowerCase();
    const filter = url.searchParams.get("filter") ?? "all";
    const replied = people.filter((p) => p.replied).length;
    const shown = people.filter(
      (p) => (filter === "all" || p.replied === (filter === "replied")) && (!q || `${p.full_name} ${p.email}`.toLowerCase().includes(q)),
    );
    return { ...pageOf(shown, url), counts: { all: people.length, replied, waiting: people.length - replied } };
  };
}
