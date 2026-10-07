export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Fired when the API says we're not logged in; AuthProvider sends the user to /login. */
export const UNAUTHORIZED_EVENT = "popsicle:unauthorized";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(API_URL + path, {
    method,
    credentials: "include", // send the session cookie
    headers: body && !isForm ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  // Logged out (or the session expired) while login is required: go log in, then come back here.
  if (res.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

// ---- Types mirroring backend/app/schemas.py ----

export type CampaignDraft = {
  company: string | null;
  name?: string | null;
  subject: string;
  body: string;
  variables: string[];
  rows: Record<string, string>[];
  attachment_ids: number[];
  template_id?: number | null;
  skip_already_sent: boolean;
  delay_seconds: number;
  scheduled_for?: string | null; // ISO time to start sending instead of now
};

export type PreviewItem = {
  index: number;
  to_email: string;
  subject: string;
  body: string;
  values: Record<string, string>;
  // undeliverable: Hunter says the address doesn't exist, so it's skipped
  status: "ready" | "already_sent" | "invalid" | "undeliverable";
  issues: string[];
  last_sent_at: string | null;
  verification?: Verification | null; // Hunter's saved verdict from the last 30 days
};

/** Hunter's verdict on whether an address exists. "pending" means Hunter was still checking. */
export type Verification = {
  email: string;
  status: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | "pending";
  score: number | null;
  checked_at: string | null;
  cached: boolean;
};

export type SendingQuota = {
  daily_limit: number;
  min_delay_seconds: number;
  sent_last_24h: number;
  remaining: number;
  next_slot_at: string;
  oldest_sent_at?: string | null;
};

export type Preview = {
  items: PreviewItem[];
  ready: number;
  already_sent: number;
  invalid: number;
  undeliverable: number;
  quota: SendingQuota;
  sends_now: number; // fit under the daily limit right away
  sends_later: number; // wait until the limit resets, then go out automatically
  later_from?: string | null; // when the waiting ones can start
};

export type Attachment = { id: number; filename: string; content_type: string; size_bytes: number; created_at: string };

export type EmailStatus = "pending" | "sent" | "failed" | "skipped" | "cancelled";
export type CampaignStatus = "queued" | "sending" | "completed" | "cancelled" | "interrupted" | "waiting" | "scheduled";

export type EmailRow = {
  id: number;
  contact_id: number | null;
  to_email: string;
  subject: string;
  body: string;
  variables: Record<string, string>;
  status: EmailStatus;
  error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type Counts = Record<"total" | EmailStatus, number>;

export type CampaignSummary = {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string | null;
  status: CampaignStatus;
  error: string | null;
  delay_seconds: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  scheduled_for?: string | null;
  counts: Counts;
};

export type CampaignDetail = CampaignSummary & {
  subject_template: string;
  body_template: string;
  variables: string[];
  attachments: Attachment[];
  emails: EmailRow[];
};

export type CompanyStatus = "not_started" | "emailed" | "replied" | "not_interested";

export type CompaniesAdded = { added: Company[]; skipped: string[] };

export type Company = {
  id: number;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  notes: string | null;
  status: CompanyStatus;
  created_at: string;
  contact_count: number;
  emailed_count: number;
  last_sent_at: string | null;
};

export type Contact = {
  id: number;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  notes: string | null;
  company_id: number | null;
  company_name: string | null;
  created_at: string;
  sent_count: number;
  last_sent_at: string | null;
  last_status: EmailStatus | null;
};

export type Template = {
  id: number;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  created_at: string;
  updated_at: string;
};

export type GmailStatus = {
  connected: boolean;
  email: string | null;
  credentials_file_present: boolean;
  can_read?: boolean; // may read replies (Conversations)
  can_meet?: boolean; // may create Google Calendar events with Meet links
};

export type ConversationSummary = {
  contact_id: number;
  email: string;
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  first_emailed_at: string | null;
  last_message_at: string | null;
  last_snippet: string;
  last_from_me: boolean;
  replied: boolean;
  message_count: number;
  next_meeting_at: string | null;
};

export type ConversationMessage = {
  id: string;
  from_me: boolean;
  from_name: string | null;
  from_addr: string;
  to: string;
  subject: string;
  body: string;
  sent_at: string;
  gmail_thread_id: string | null;
};

export type Meeting = {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  meet_url: string;
  calendar_url: string | null;
  calendar_invite: boolean;
  created_at: string;
};

export type ConversationDetail = ConversationSummary & { messages: ConversationMessage[]; meetings: Meeting[] };

export type ConversationSync = {
  running?: boolean; // the check runs in the background; poll until false
  threads_checked: number;
  threads_downloaded: number;
  new_messages: number;
  synced_at: string | null;
  error?: string | null;
};

export type Stats = {
  sent_total: number;
  sent_last_7_days: number;
  companies: number;
  contacts: number;
  failed_total: number;
};

// ---- Finding people (Hunter.io) ----

export type HunterStatus = {
  configured: boolean;
  plan_name: string | null;
  credits_used: number | null;
  credits_total: number | null; // the monthly allowance
  credits_remaining: number | null;
  verifications_total?: number | null; // monthly email verifications, counted separately
  verifications_remaining?: number | null;
  reset_date: string | null;
  error: string | null;
};

export type FoundPerson = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string | null;
  department: string | null;
  seniority: string | null;
  confidence: number | null;
  verification_status: string | null;
  linkedin_url: string | null;
  already_emailed_at: string | null;
};

export type PeopleSearch = {
  domain: string | null;
  organization: string | null;
  pattern: string | null;
  total: number;
  offset: number;
  limit: number;
  people: FoundPerson[];
  cached: boolean;
};

export type EmailFinderResult = { person: FoundPerson | null; domain: string | null; company: string | null; cached: boolean };

export type CompanySuggestion = { name: string | null; domain: string; logo: string | null; email_count: number | null };

export type PeopleCount = { total: number; by_department: Record<string, number>; by_seniority: Record<string, number> };

// ---- Auth ----

export type AuthUser = { email: string; name: string | null };

export type Me = { user: AuthUser | null; auth_required: boolean };
