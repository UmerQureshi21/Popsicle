import type { CampaignSummary, Company, CompanyStatus, Contact, ConversationSummary, Page } from "@/lib/api";
import { api, type Call } from "./server";

/**
 * Fake list endpoints that answer like the backend: a page at a time (?limit=&offset=), with
 * the filter, search and counts worked out over the whole list. The list can be a function, to
 * change between requests.
 */
type List<T> = T[] | (() => T[]);
const all = <T>(list: List<T>) => (typeof list === "function" ? list() : list);

export function pageOf<T>(items: T[], url: URL): Page<T> {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const end = offset + limit;
  return { items: items.slice(offset, end), total: items.length, next_offset: end < items.length ? end : null };
}

const has = (q: string, ...values: (string | null | undefined)[]) => values.some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export function companiesApi(list: List<Company>): Call[] {
  return api("get", "/api/companies", ({ url }) => {
    const q = url.searchParams.get("q");
    const status = url.searchParams.get("status") as CompanyStatus | null;
    const matching = all(list).filter((c) => !q || has(q, c.name, c.domain));
    const counts = { not_started: 0, emailed: 0, replied: 0, not_interested: 0 };
    matching.forEach((c) => counts[c.status]++);
    const shown = status ? matching.filter((c) => c.status === status) : matching;
    return { ...pageOf(shown, url), counts, all: matching.length, missing_domains: matching.filter((c) => !c.domain).length };
  });
}

export function contactsApi(list: List<Contact>): Call[] {
  return api("get", "/api/contacts", ({ url }) => {
    const q = url.searchParams.get("q");
    const companyId = url.searchParams.get("company_id");
    return pageOf(
      all(list).filter((c) => (!q || has(q, c.email, c.full_name, c.title)) && (!companyId || String(c.company_id) === companyId)),
      url,
    );
  });
}

export function conversationsApi(list: List<ConversationSummary>): Call[] {
  return api("get", "/api/conversations", ({ url }) => {
    const q = url.searchParams.get("q");
    const filter = url.searchParams.get("filter") ?? "all";
    const people = all(list);
    const replied = people.filter((p) => p.replied).length;
    const shown = people.filter(
      (p) => (filter === "all" || p.replied === (filter === "replied")) && (!q || has(q, p.full_name, p.email, p.company_name)),
    );
    return { ...pageOf(shown, url), counts: { all: people.length, replied, waiting: people.length - replied } };
  });
}

export function campaignsApi(list: List<CampaignSummary>): Call[] {
  return api("get", "/api/campaigns", ({ url }) => pageOf(all(list), url));
}
