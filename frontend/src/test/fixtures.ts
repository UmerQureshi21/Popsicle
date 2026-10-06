import type { CampaignDetail, EmailRow, FoundPerson, HunterStatus, PeopleSearch, SendingQuota, Template } from "@/lib/api";

export function person(overrides: Partial<FoundPerson> = {}): FoundPerson {
  return {
    email: "jane@stripe.com",
    first_name: "Jane",
    last_name: "Doe",
    full_name: "Jane Doe",
    position: "Software Engineer",
    department: "it",
    seniority: "senior",
    confidence: 95,
    verification_status: "valid",
    linkedin_url: null,
    already_emailed_at: null,
    ...overrides,
  };
}

export function search(people: FoundPerson[], overrides: Partial<PeopleSearch> = {}): PeopleSearch {
  return {
    domain: "stripe.com",
    organization: "Stripe",
    pattern: "{first}",
    total: people.length,
    offset: 0,
    limit: 10,
    people,
    cached: false,
    ...overrides,
  };
}

export function hunterStatus(overrides: Partial<HunterStatus> = {}): HunterStatus {
  return {
    configured: true,
    plan_name: "Free",
    credits_used: 10,
    credits_total: 50,
    credits_remaining: 40,
    reset_date: "2026-11-02",
    error: null,
    ...overrides,
  };
}

export function email(overrides: Partial<EmailRow> = {}): EmailRow {
  return {
    id: 1,
    contact_id: 1,
    to_email: "jane@stripe.com",
    subject: "Hi Jane",
    body: "Hello",
    variables: {},
    status: "pending",
    error: null,
    sent_at: null,
    created_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

export function campaign(overrides: Partial<CampaignDetail> = {}): CampaignDetail {
  const emails = overrides.emails ?? [email()];
  const counts = { total: emails.length, pending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 };
  for (const e of emails) counts[e.status]++;
  return {
    id: 7,
    name: "Stripe",
    company_id: 1,
    company_name: "Stripe",
    status: "sending",
    error: null,
    delay_seconds: 30,
    created_at: "2026-10-01T12:00:00Z",
    started_at: "2026-10-01T12:00:00Z",
    finished_at: null,
    counts,
    subject_template: "Hi {{first_name}}",
    body_template: "Hello",
    variables: ["full_name", "email"],
    attachments: [],
    emails,
    ...overrides,
  };
}

export function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 1,
    name: "Intro",
    subject: "Hi {{first_name}}",
    body: "Hello",
    variables: [],
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...overrides,
  };
}

export function quota(overrides: Partial<SendingQuota> = {}): SendingQuota {
  return {
    daily_limit: 40,
    min_delay_seconds: 20,
    sent_last_24h: 6,
    remaining: 34,
    next_slot_at: "2026-10-06T12:00:00Z",
    oldest_sent_at: "2026-10-05T15:00:00Z",
    ...overrides,
  };
}
