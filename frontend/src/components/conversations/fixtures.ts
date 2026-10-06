import type { ConversationDetail, ConversationMessage, ConversationSummary, Meeting } from "@/lib/api";

export const person = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  contact_id: 3, email: "douglas.quan@ibm.com", full_name: "Douglas Quan", title: "Software Engineer", linkedin_url: "https://linkedin.com/in/dq",
  company_name: "IBM", company_domain: "ibm.com", first_emailed_at: "2026-10-04T19:08:00Z", last_message_at: "2026-10-05T14:00:00Z",
  last_snippet: "Coffee next week works!", last_from_me: false, replied: true, message_count: 2, next_meeting_at: null, ...overrides,
});

export const msg = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: "m1", from_me: true, from_name: null, from_addr: "me@gmail.com", to: "douglas.quan@ibm.com", subject: "Coffee chat Request",
  body: "Hi Douglas, would you have 30 minutes?", sent_at: "2026-10-04T19:08:00Z", gmail_thread_id: "t1", ...overrides,
});

export const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 1, title: "Coffee chat with Douglas", starts_at: "2030-10-07T14:00:00Z", ends_at: "2030-10-07T14:30:00Z", time_zone: "America/Toronto",
  meet_url: "https://meet.google.com/abc-defg-hij", calendar_url: "https://calendar.google.com/event?eid=1", calendar_invite: true,
  created_at: "2026-10-06T12:00:00Z", ...overrides,
});

export const detail = (overrides: Partial<ConversationDetail> = {}): ConversationDetail => ({
  ...person(),
  messages: [
    msg(),
    msg({ id: "m2", from_me: false, from_name: "Douglas Quan", from_addr: "douglas.quan@ibm.com", subject: "Re: Coffee chat Request", body: "Coffee next week works!", sent_at: "2026-10-05T14:00:00Z" }),
  ],
  meetings: [],
  ...overrides,
});
