export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(API_URL + path, {
    method,
    headers: body && !isForm ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
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
};

export type PreviewItem = {
  index: number;
  to_email: string;
  subject: string;
  body: string;
  values: Record<string, string>;
  status: "ready" | "already_sent" | "invalid";
  issues: string[];
  last_sent_at: string | null;
};

export type Preview = { items: PreviewItem[]; ready: number; already_sent: number; invalid: number };

export type Attachment = { id: number; filename: string; content_type: string; size_bytes: number; created_at: string };

export type EmailStatus = "pending" | "sent" | "failed" | "skipped" | "cancelled";
export type CampaignStatus = "queued" | "sending" | "completed" | "cancelled" | "interrupted";

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
  counts: Counts;
};

export type CampaignDetail = CampaignSummary & {
  subject_template: string;
  body_template: string;
  variables: string[];
  attachments: Attachment[];
  emails: EmailRow[];
};

export type Company = {
  id: number;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  notes: string | null;
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

export type GmailStatus = { connected: boolean; email: string | null; credentials_file_present: boolean };

export type Stats = {
  sent_total: number;
  sent_last_7_days: number;
  companies: number;
  contacts: number;
  failed_total: number;
};
