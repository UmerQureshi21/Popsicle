"use client";

import { safeHref } from "@/lib/safeUrl";
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Check, ChevronLeft, Copy, ExternalLink, Link2, MessagesSquare, RefreshCw, Search, Video, X } from "lucide-react";
import {
  API_URL,
  api,
  type ConversationDetail,
  type ConversationPage,
  type ConversationSync,
  type GmailStatus,
  type Meeting,
} from "@/lib/api";
import { readGmailNotice } from "@/lib/draft";
import { sleep } from "@/lib/pieces";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useDebounced, usePaged } from "@/lib/paged";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { CompanyLogo } from "@/components/CompanyAutocomplete";
import LoadMore from "@/components/LoadMore";
import MeetScheduler from "./MeetScheduler";
import SendBookingLink from "./SendBookingLink";

type Filter = "all" | "replied" | "waiting";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "replied", label: "Replied" },
  { value: "waiting", label: "No reply yet" },
];

const nameOf = (p: { full_name: string | null; email: string }) => p.full_name || p.email;

function meetingRange(m: Meeting): string {
  const start = new Date(m.starts_at);
  const end = new Date(m.ends_at);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(start)} – ${t(end)}`;
}

function MeetingCard({ m }: { m: Meeting }) {
  const [copied, setCopied] = useState(false);
  const past = new Date(m.ends_at) < new Date();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.meet_url);
      setCopied(true);
    } catch {}
  };
  return (
    <li className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${past ? "border-cloud bg-cloud/40" : "border-crimson/20 bg-crimson/5"}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${past ? "bg-paper text-steel" : "bg-crimson text-white"}`}>
        <Video className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{m.title}</p>
        <p className="text-xs text-steel">
          {meetingRange(m)}
          {past && " · done"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <a href={safeHref(m.meet_url)} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-xs font-medium text-crimson hover:bg-paper">
          {m.meet_url.replace(/^https:\/\//, "")}
        </a>
        <button onClick={copy} aria-label="Copy Meet link" className="rounded-lg p-1.5 text-steel hover:bg-paper hover:text-ink">
          {copied ? <Check className="size-4 text-crimson" /> : <Copy className="size-4" />}
        </button>
        {safeHref(m.calendar_url) && (
          <a href={safeHref(m.calendar_url)} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar" className="rounded-lg p-1.5 text-steel hover:bg-paper hover:text-ink">
            <CalendarDays className="size-4" />
          </a>
        )}
      </div>
    </li>
  );
}

function Thread({ detail }: { detail: ConversationDetail }) {
  const topic = (subject: string) => subject.replace(/^(re|fwd?):\s*/i, "");
  return (
    <ol className="space-y-4">
      {detail.messages.map((m, i) => {
        // Show the subject when the conversation starts or moves to a new one.
        const showSubject = !!topic(m.subject) && (i === 0 || topic(detail.messages[i - 1].subject) !== topic(m.subject));
        return (
          <li key={m.id} className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${m.from_me ? "items-end" : "items-start"} flex flex-col`}>
              <p className="mb-1 px-1 text-xs text-steel">
                <span className="font-medium text-ink/80">{m.from_me ? "You" : m.from_name || nameOf(detail)}</span> ·{" "}
                {formatDateTime(m.sent_at)}
              </p>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
                  m.from_me ? "rounded-br-md bg-night text-white" : "rounded-bl-md border border-cloud bg-paper text-ink"
                }`}
              >
                {showSubject && <p className={`mb-1.5 text-xs font-semibold ${m.from_me ? "text-white/70" : "text-steel"}`}>{m.subject}</p>}
                {m.body}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// A check of Gmail already on its way. Starting another (e.g. React running effects twice in
// development) shares it instead of being refused as "already checking".
let inflight: Promise<ConversationSync> | null = null;

export const POLL_MS = 1500;

/** Start a Gmail check (it runs in the background on the server) and wait for it to finish. */
async function runCheck(): Promise<ConversationSync> {
  let status = await api.post<ConversationSync>("/api/conversations/sync");
  while (status.running) {
    await sleep(POLL_MS);
    status = await api.get<ConversationSync>("/api/conversations/sync");
  }
  if (status.error) throw new Error(status.error);
  return status;
}

function checkGmail(): Promise<ConversationSync> {
  inflight ??= runCheck().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Everyone you've emailed, what was said since, and Google Meet invites. */
export default function Conversations() {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), 250);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("contact"));
    return id > 0 ? id : null;
  });
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => readGmailNotice());
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [offeringTimes, setOfferingTimes] = useState(false);

  // One page at a time; the filter and search run on the server, so they cover everyone.
  const list = usePaged<ConversationPage>(`/api/conversations?${new URLSearchParams({ filter, ...(search ? { q: search } : {}) })}`);
  const { reload: loadList } = list;
  const people = list.items;
  const loadDetail = useCallback(
    (id: number) => api.get<ConversationDetail>(`/api/conversations/${id}`).then(setDetail, (e) => setError(e.message)),
    [],
  );

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await checkGmail();
      setSyncedAt(res.synced_at ?? new Date().toISOString());
      if (res.new_messages) setNotice(`${res.new_messages} new message${res.new_messages === 1 ? "" : "s"} from Gmail.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Load what's saved, then check Gmail for anything new.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    api.get<GmailStatus>("/api/gmail/status").then(
      async (g) => {
        setGmail(g);
        if (g.can_read) {
          await sync();
          loadList();
        }
      },
      () => setGmail(null),
    );
  }, [loadList, sync]);

  useEffect(() => {
    if (selectedId != null) loadDetail(selectedId);
  }, [selectedId, loadDetail, syncedAt]);

  const refresh = async () => {
    await sync();
    loadList();
  };

  const select = (id: number | null) => {
    setDetail(null);
    setSelectedId(id);
  };

  const shown = people ?? [];
  const counts = list.data?.counts ?? { all: 0, replied: 0, waiting: 0 };
  const selected = people?.find((p) => p.contact_id === selectedId) ?? detail;
  const needsPermission = gmail?.connected && (!gmail.can_read || !gmail.can_meet);

  return (
    <div className="space-y-4">
      {gmail && !gmail.connected && (
        <p className="rounded-2xl bg-crimson/5 px-4 py-3 text-sm text-crimson">
          Connect Gmail to see replies.{" "}
          <a href={`${API_URL}/api/gmail/connect?next=/conversations`} className="font-semibold underline underline-offset-2">
            Connect Gmail
          </a>
        </p>
      )}
      {needsPermission && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-crimson/20 bg-crimson/5 px-4 py-3 text-sm text-ink">
          <span>
            <span className="font-semibold">One more step:</span>{" "}
            {!gmail.can_read && !gmail.can_meet
              ? "let Popsicle read your Gmail (to show replies) and manage calendar events (to make Google Meet links)."
              : !gmail.can_read
                ? "let Popsicle read your Gmail to show replies."
                : "let Popsicle manage calendar events to make Google Meet links."}{" "}
            Tick every box on Google’s screen.
          </span>
          <a
            href={`${API_URL}/api/gmail/connect?next=/conversations`}
            className="rounded-xl bg-crimson px-3.5 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-scarlet"
          >
            Reconnect Gmail
          </a>
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-4 py-2.5 text-sm text-ink">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-steel hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
      {(error ?? list.error) && <p className="text-sm text-crimson">{error ?? list.error}</p>}

      {list.data && counts.all === 0 ? (
        <EmptyState icon={<MessagesSquare className="size-5" />} title="No conversations yet">
          Everyone you email shows up here, with their replies.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:h-[calc(100vh-15rem)] md:min-h-[32rem] md:grid-cols-[320px_minmax(0,1fr)]">
          {/* grid-cols-1 caps the phone column at the screen's width; without it the column grows to fit the
              longest last message before truncating it, and the whole page zooms out. */}
          {/* People */}
          <section className={`flex min-h-0 min-w-0 flex-col rounded-3xl border border-cloud bg-paper shadow-sm ${selectedId != null ? "hidden md:flex" : ""}`}>
            <div className="space-y-3 border-b border-cloud p-3">
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-xl bg-cloud/60 px-3 py-2">
                  <Search className="size-4 text-steel" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people"
                    aria-label="Search people"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-steel"
                  />
                </label>
                <button
                  onClick={refresh}
                  disabled={syncing || !gmail?.can_read}
                  aria-label="Check Gmail for replies"
                  title={syncedAt ? `Checked ${timeAgo(syncedAt)}` : "Check Gmail for replies"}
                  className="rounded-xl p-2 text-steel hover:bg-cloud hover:text-ink disabled:opacity-40"
                >
                  <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div role="tablist" aria-label="Filter conversations" className="flex gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    role="tab"
                    aria-selected={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f.value ? "bg-night text-white" : "text-steel hover:bg-cloud hover:text-ink"}`}
                  >
                    {f.label} {counts[f.value]}
                  </button>
                ))}
              </div>
              {syncing && <p className="text-xs text-steel">Checking Gmail for replies…</p>}
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-cloud overflow-y-auto">
              {!people && !list.error && <li className="p-4 text-sm text-steel">Loading…</li>}
              {people && shown.length === 0 && <li className="p-4 text-sm text-steel">Nobody matches.</li>}
              {shown.map((p) => (
                <li key={p.contact_id}>
                  <button
                    onClick={() => select(p.contact_id)}
                    aria-current={p.contact_id === selectedId}
                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors ${p.contact_id === selectedId ? "bg-cloud/70" : "hover:bg-cloud/40"}`}
                  >
                    <Avatar name={nameOf(p)} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{nameOf(p)}</span>
                        {p.replied && <span className="size-2 shrink-0 rounded-full bg-crimson" aria-label="replied" />}
                        <span className="ml-auto shrink-0 text-xs text-steel">{timeAgo(p.last_message_at)}</span>
                      </span>
                      {p.company_name && <span className="block truncate text-xs text-steel">{p.company_name}</span>}
                      <span className="mt-0.5 block truncate text-xs text-ink/70">
                        {p.last_from_me && "You: "}
                        {p.last_snippet}
                      </span>
                      {p.next_meeting_at && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-crimson/10 px-2 py-0.5 text-[11px] font-medium text-crimson">
                          <Video className="size-3" /> {formatDateTime(p.next_meeting_at)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {list.data && (
                <li>
                  <LoadMore
                    shown={list.data.items.length}
                    total={list.data.total}
                    hasMore={list.data.next_offset != null}
                    loading={list.loadingMore}
                    onMore={list.loadMore}
                    className="flex-col gap-2 text-xs"
                  />
                </li>
              )}
            </ul>
          </section>

          {/* One conversation */}
          <section className={`flex min-h-0 min-w-0 flex-col rounded-3xl border border-cloud bg-paper shadow-sm ${selectedId == null ? "hidden md:flex" : ""}`}>
            {selectedId == null || !selected ? (
              <div className="grid flex-1 place-items-center p-10 text-center text-sm text-steel">
                {selectedId == null ? "Pick someone to see your conversation." : "Loading…"}
              </div>
            ) : (
              <>
                <header className="flex flex-wrap items-center gap-3 border-b border-cloud p-4">
                  <button onClick={() => select(null)} aria-label="Back to everyone" className="-ml-1 rounded-lg p-1 text-steel hover:bg-cloud md:hidden">
                    <ChevronLeft className="size-5" />
                  </button>
                  <Avatar name={nameOf(selected)} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-semibold text-ink">
                      {nameOf(selected)}
                      {safeHref(selected.linkedin_url) && (
                        <a href={safeHref(selected.linkedin_url)} target="_blank" rel="noreferrer" aria-label="LinkedIn profile" className="text-steel hover:text-ink">
                          <Link2 className="size-4" />
                        </a>
                      )}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-steel">
                      {selected.company_name && (
                        <>
                          <CompanyLogo domain={selected.company_domain} size={14} />
                          {[selected.title, selected.company_name].filter(Boolean).join(" · ")} ·
                        </>
                      )}{" "}
                      {selected.email}
                    </p>
                  </div>
                  <Button onClick={() => setOfferingTimes(true)} disabled={!detail} aria-label="Send booking link" className="shrink-0">
                    <CalendarCheck className="size-4" /> <span className="hidden sm:inline">Booking link</span>
                  </Button>
                  <Button variant="primary" onClick={() => setScheduling(true)} disabled={!detail} aria-label="Send Meet link" className="shrink-0">
                    <Video className="size-4" /> <span className="hidden sm:inline">Send Meet link</span>
                    <span className="sm:hidden">Meet</span>
                  </Button>
                </header>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-cloud/30 p-4 sm:p-6">
                  {!detail ? (
                    <p className="text-sm text-steel">Loading…</p>
                  ) : (
                    <>
                      {detail.meetings.length > 0 && (
                        <ul className="space-y-2">
                          {detail.meetings.map((m) => (
                            <MeetingCard key={m.id} m={m} />
                          ))}
                        </ul>
                      )}
                      <Thread detail={detail} />
                      {!detail.replied && (
                        <p className="text-center text-xs text-steel">
                          No reply yet{gmail?.can_read ? "" : " (or Popsicle can’t read your Gmail yet)"}.
                        </p>
                      )}
                    </>
                  )}
                </div>
                {detail && (
                  <a
                    href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(detail.email)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 border-t border-cloud py-2.5 text-xs font-medium text-steel hover:text-ink"
                  >
                    Reply in Gmail <ExternalLink className="size-3.5" />
                  </a>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {offeringTimes && selected && (
        <SendBookingLink
          person={selected}
          onClose={() => setOfferingTimes(false)}
          onSent={() => {
            setOfferingTimes(false);
            setNotice(`Booking link sent to ${nameOf(selected)}. Their call shows up here once they pick a time.`);
            loadDetail(selected.contact_id);
            loadList();
          }}
        />
      )}
      {scheduling && selected && (
        <MeetScheduler
          person={selected}
          gmail={gmail}
          onClose={() => setScheduling(false)}
          onScheduled={(m) => {
            setScheduling(false);
            setNotice(`Meet link sent to ${nameOf(selected)} for ${meetingRange(m)}.`);
            loadDetail(selected.contact_id);
            loadList();
          }}
        />
      )}
    </div>
  );
}
