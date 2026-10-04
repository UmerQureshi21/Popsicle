"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  MoreVertical,
  Paperclip,
  Send,
  UserCheck,
  UserSearch,
  Users,
} from "lucide-react";
import {
  API_URL,
  api,
  type Attachment,
  type CampaignDetail,
  type CampaignDraft,
  type Company,
  type GmailStatus,
  type FoundPerson,
  type Template,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { clearHandoff, peopleToRows, readHandoff } from "@/lib/people";
import { derivedVariables, parseTuples, placeholdersIn, validateRows } from "@/lib/tuples";
import { Avatar, Button, Modal, Popover, Tooltip } from "@/components/ui";
import CampaignProgress from "@/components/CampaignProgress";
import HighlightEditor, { type EditorHandle } from "./HighlightEditor";
import PreviewModal from "./PreviewModal";
import TemplateMenu from "./TemplateMenu";
import FindPeopleModal from "./FindPeopleModal";
import RecipientsTable from "./RecipientsTable";

type Draft = {
  company: string;
  variables: string[];
  rows: Record<string, string>[]; // one per recipient, keyed by variable name
  subject: string;
  body: string;
  attachments: Attachment[];
  delaySeconds: number;
  skipAlreadySent: boolean;
  templateId: number | null;
};

const STORAGE_KEY = "cold-emailer:compose-draft:v1";

const DEFAULT_DRAFT: Draft = {
  company: "",
  variables: ["full_name", "email"],
  rows: [{}],
  subject: "Quick question about {{company}}",
  body: "Hi {{first_name}},\n\nI came across your profile while looking into {{company}} and was really interested in the work your team is doing.\n\n…\n\nWould you be open to a quick 15-minute chat sometime next week?\n\nBest,\nUmer",
  attachments: [],
  delaySeconds: 30,
  skipAlreadySent: true,
  templateId: null,
};

function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { tuplesText, ...rest } = JSON.parse(saved);
      const draft: Draft = { ...DEFAULT_DRAFT, ...rest };
      // Drafts from before the recipients table stored pasted tuples as text.
      if (!rest.rows && tuplesText) {
        const rows = parseTuples(tuplesText).map(({ values }) =>
          Object.fromEntries(draft.variables.map((v, i) => [v, values[i] ?? ""])),
        );
        if (rows.length) draft.rows = rows;
      }
      return draft;
    }
  } catch {}
  return DEFAULT_DRAFT;
}

/** The saved draft, with people sent over from the Find people page loaded as a fresh batch. */
function loadInitial(): { draft: Draft; notice: string | null } {
  const draft = loadDraft();
  const handoff = readHandoff();
  if (!handoff?.people.length) return { draft, notice: readGmailNotice() };
  const { variables, rows } = peopleToRows(handoff.people, draft.variables);
  const n = handoff.people.length;
  return {
    draft: { ...draft, variables, rows, company: handoff.company ?? draft.company },
    notice: `Loaded ${n} ${n === 1 ? "person" : "people"}${handoff.company ? ` from ${handoff.company}` : ""}. Check the email below, then send.`,
  };
}

function readGmailNotice(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("gmail") === "connected") return "Gmail connected. You’re ready to send.";
  if (params.get("gmail_error") === "missing_send_permission")
    return "Gmail wasn’t connected: the “Send email on your behalf” box was unticked. Click Connect Gmail and tick it.";
  if (params.get("gmail_error")) return `Couldn’t connect Gmail (${params.get("gmail_error")}). Try again.`;
  return null;
}

export default function Compose() {
  const [initial] = useState(loadInitial);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const { company, variables, rows, subject, body, attachments, delaySeconds, skipAlreadySent, templateId } = draft;

  const [panelOpen, setPanelOpen] = useState(true);
  const [menu, setMenu] = useState<"templates" | "delay" | "skip" | null>(null);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState<CampaignDraft | null>(null);
  const [findingPeople, setFindingPeople] = useState(false);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);

  const subjectRef = useRef<EditorHandle>(null);
  const bodyRef = useRef<EditorHandle>(null);
  const lastFocused = useRef<"subject" | "body">("body");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  useEffect(() => {
    clearHandoff();
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    api.get<GmailStatus>("/api/gmail/status").then(setGmail, () => setGmail(null));
    api.get<Company[]>("/api/companies").then(setCompanies, () => {});
  }, []);

  const recipients = useMemo(() => validateRows(rows, variables), [rows, variables]);
  const rowErrors = recipients.filter((r) => r.error).length;
  const hasCompany = !!company.trim();
  const derived = useMemo(() => derivedVariables(variables, hasCompany), [variables, hasCompany]);
  const known = useMemo(() => new Set([...variables, ...derived]), [variables, derived]);
  const unknown = placeholdersIn(subject, body).filter((p) => !known.has(p));

  const problem = !recipients.length
    ? "Add at least one recipient"
    : rowErrors
      ? `${rowErrors} recipient row${rowErrors === 1 ? " needs" : "s need"} fixing`
      : !subject.trim()
        ? "Add a subject"
        : unknown.length
          ? `Unknown variable${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`
          : null;

  const insertVariable = (v: string) => (lastFocused.current === "subject" ? subjectRef : bodyRef).current?.insert(`{{${v}}}`);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.append("file", f);
        added.push(await api.post<Attachment>("/api/attachments", form));
      }
      set({ attachments: [...attachments, ...added] });
    } catch (e) {
      setNotice(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const loadTemplate = (t: Template) => {
    set({
      subject: t.subject,
      body: t.body,
      templateId: t.id,
      // Keep the current variables unless the template brings its own.
      variables: t.variables.length ? t.variables : variables,
    });
  };

  const openReview = () =>
    setReviewing({
      company: company.trim() || null,
      subject,
      body,
      variables,
      rows: recipients.map((r) => r.values),
      attachment_ids: attachments.map((a) => a.id),
      template_id: templateId,
      skip_already_sent: skipAlreadySent,
      delay_seconds: delaySeconds,
    });

  // People picked in "Find people" become rows, filling whichever columns match what Hunter knows.
  const addFoundPeople = (people: FoundPerson[], organization: string | null) => {
    const existing = new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean));
    const kept = rows.filter((r) => Object.values(r).some((v) => v?.trim()));
    const { variables: vars, rows: added } = peopleToRows(
      people.filter((p) => !existing.has(p.email)),
      variables,
    );
    set({
      variables: vars,
      rows: kept.length + added.length ? [...kept, ...added] : [{}],
      ...(company.trim() || !organization ? {} : { company: organization }),
    });
    setPanelOpen(true);
    const skipped = people.length - added.length;
    setNotice(
      `Added ${added.length} ${added.length === 1 ? "person" : "people"} to recipients` +
        (skipped ? ` (${skipped} already in the list).` : "."),
    );
  };

  const startNextBatch = () => {
    set({ rows: [{}], company: "" });
    setCampaign(null);
    setPanelOpen(true);
    api.get<Company[]>("/api/companies").then(setCompanies, () => {});
  };

  const totalMinutes = Math.ceil((Math.max(recipients.length - 1, 0) * delaySeconds) / 60);

  return (
    <>
      {notice && (
        <div className="animate-fade-up mx-auto mb-4 flex max-w-3xl items-center justify-between rounded-2xl bg-white/90 px-4 py-3 text-sm text-ink shadow-lg backdrop-blur">
          {notice}
          <button className="text-steel hover:text-ink" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mx-auto max-w-3xl rounded-[28px] border border-white/60 bg-white/70 p-2 shadow-[0_40px_100px_-30px_rgba(43,45,66,0.55)] backdrop-blur-2xl">
        <div className="rounded-[22px] bg-white/95 px-5 pt-6 pb-5 shadow-sm sm:px-8 sm:pt-7 sm:pb-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="shrink-0 text-lg font-semibold text-ink">New email</h1>
            {gmail?.connected ? (
              <Tooltip label="Sending from this account · click to reconnect">
                <a
                  href={`${API_URL}/api/gmail/connect`}
                  className="flex min-w-0 items-center gap-2 rounded-full bg-cloud px-3 py-1 text-xs text-ink hover:bg-steel/20"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="max-w-40 truncate sm:max-w-none">{gmail.email}</span>
                </a>
              </Tooltip>
            ) : gmail?.credentials_file_present ? (
              <a href={`${API_URL}/api/gmail/connect`} className="rounded-full bg-crimson px-3 py-1 text-xs font-medium text-white hover:bg-scarlet">
                Connect Gmail
              </a>
            ) : (
              <Tooltip label="Add backend/credentials.json; see README">
                <span className="rounded-full bg-cloud px-3 py-1 text-xs text-steel">Gmail not set up</span>
              </Tooltip>
            )}
          </div>

          {/* Company */}
          <div className="mt-6 flex items-center gap-4 border-b border-cloud pb-3">
            <span className="w-16 text-sm text-steel">Company</span>
            <Building2 className="size-4 text-steel" />
            <input
              value={company}
              onChange={(e) => set({ company: e.target.value })}
              list="company-options"
              placeholder="e.g. Stripe"
              className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-steel/60"
            />
            <datalist id="company-options">
              {companies.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>

          {/* To */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-cloud py-3">
            <span className="w-16 text-sm text-steel">To</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {recipients.length === 0 && <span className="text-[15px] text-steel/60">Add recipients below</span>}
              {recipients.slice(0, 3).map((r, i) => (
                <span
                  key={i}
                  className={`flex max-w-full min-w-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm shadow-sm ${
                    r.error ? "border-crimson/30 bg-crimson/5 text-crimson" : "border-cloud bg-white text-ink"
                  }`}
                >
                  <Avatar name={r.values.full_name || r.values.name || r.values.email || "?"} size={24} />
                  <span className="truncate">{r.values.email || "missing email"}</span>
                </span>
              ))}
              {recipients.length > 3 && (
                <span className="rounded-full bg-cloud px-3 py-1.5 text-sm font-medium text-ink">+{recipients.length - 3} more</span>
              )}
            </div>
            {/* On phones these drop to their own row under the recipients */}
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                onClick={() => setPanelOpen(!panelOpen)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                  panelOpen ? "bg-ink text-white" : "bg-cloud text-ink hover:bg-steel/20"
                }`}
              >
                <Users className="size-4" />
                Recipients
                {rowErrors > 0 && <span className="size-1.5 rounded-full bg-scarlet" />}
                <ChevronDown className={`size-4 transition-transform ${panelOpen ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => setFindingPeople(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-crimson/10 px-3 py-1.5 text-sm font-medium text-crimson transition-colors hover:bg-crimson/15"
              >
                <UserSearch className="size-4" />
                Find people
              </button>
            </div>
          </div>

          {panelOpen && (
            <div className="mt-4">
              <RecipientsTable
                variables={variables}
                onVariablesChange={(v) => set({ variables: v })}
                rows={rows}
                onRowsChange={(r) => set({ rows: r })}
                recipients={recipients}
              />
            </div>
          )}

          {/* Email: same panel style as the recipients table */}
          <div className="mt-6 rounded-2xl bg-cloud/70 p-5">
            {/* Subject */}
            <HighlightEditor
              ref={subjectRef}
              ariaLabel="Subject"
              singleLine
              value={subject}
              onChange={(v) => set({ subject: v })}
              known={known}
              placeholder="Subject"
              onFocus={() => (lastFocused.current = "subject")}
              className="text-[26px] leading-tight font-semibold tracking-tight"
            />

            {/* Variable toolbar */}
            <div className="sticky top-20 z-10 mt-4 flex justify-start">
              <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl bg-ink p-1 shadow-lg">
                <span className="px-2 text-xs text-white/50">Insert</span>
                {[...variables, ...derived].map((v) => (
                  <button
                    key={v}
                    onMouseDown={(e) => e.preventDefault()} // keep the caret where it is
                    onClick={() => insertVariable(v)}
                    className={`rounded-lg px-2 py-1 font-mono text-xs transition-colors hover:bg-white/15 ${
                      derived.includes(v) ? "text-white/60" : "text-white"
                    }`}
                    title={derived.includes(v) ? "Derived automatically" : "From your recipients table"}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <HighlightEditor
              ref={bodyRef}
              ariaLabel="Email body"
              value={body}
              onChange={(v) => set({ body: v })}
              known={known}
              minHeight={260}
              placeholder="Write your email. Use {{variable}} where each person’s details should go."
              onFocus={() => (lastFocused.current = "body")}
              className="mt-3 text-[15px] leading-7"
            />

            {unknown.length > 0 && (
              <p className="mt-3 text-sm text-crimson">
                {unknown.map((u) => `{{${u}}}`).join(", ")} {unknown.length === 1 ? "isn’t a variable" : "aren’t variables"}.{" "}
                <button
                  className="font-medium underline underline-offset-2"
                  onClick={() => {
                    set({ variables: [...variables, ...unknown] });
                    setPanelOpen(true);
                  }}
                >
                  Add as variable
                </button>
              </p>
            )}
          </div>

          {/* Attachments */}
          {(attachments.length > 0 || uploading) && (
            <div className="mt-6">
              <p className="mb-3 text-sm text-steel">
                {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-3">
                {attachments.map((a) => (
                  <div key={a.id} className="flex w-60 items-center gap-3 rounded-xl border border-cloud bg-white p-3 shadow-sm">
                    <span className="relative grid h-10 w-8 place-items-end rounded-md border border-cloud bg-cloud/50 pb-1">
                      <span className="rounded bg-crimson px-1 text-[8px] font-bold text-white uppercase">
                        {a.filename.split(".").pop()?.slice(0, 4)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{a.filename}</span>
                      <span className="text-xs text-steel">{formatBytes(a.size_bytes)}</span>
                    </span>
                    <button
                      onClick={() => set({ attachments: attachments.filter((x) => x.id !== a.id) })}
                      className="rounded-lg p-1 text-steel hover:bg-cloud hover:text-crimson"
                      aria-label={`Remove ${a.filename}`}
                      title="Remove"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div className="grid w-60 place-items-center rounded-xl border border-dashed border-steel/40 p-3 text-steel">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer toolbar */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-1">
            <Tooltip label="Attach files">
              <button onClick={() => fileInput.current?.click()} className="rounded-xl p-2.5 text-ink/60 hover:bg-white/80 hover:text-ink">
                <Paperclip className="size-5" />
              </button>
            </Tooltip>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />

            <div className="relative">
              <Tooltip label="Spacing between emails">
                <button
                  onClick={() => setMenu(menu === "delay" ? null : "delay")}
                  className={`rounded-xl p-2.5 hover:bg-white/80 hover:text-ink ${menu === "delay" ? "bg-white text-ink" : "text-ink/60"}`}
                >
                  <Clock className="size-5" />
                </button>
              </Tooltip>
              <Popover open={menu === "delay"} onClose={() => setMenu(null)} className="bottom-full left-0 mb-3 w-72">
                <p className="text-sm font-medium text-ink">Wait ~{delaySeconds}s between emails</p>
                <p className="mt-1 text-xs text-steel">Randomized ±50% so sends don’t look automated.</p>
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={5}
                  value={delaySeconds}
                  onChange={(e) => set({ delaySeconds: Number(e.target.value) })}
                  className="mt-3 w-full accent-crimson"
                />
              </Popover>
            </div>

            <div className="relative">
              <Tooltip label="Use template">
                <button
                  onClick={() => setMenu(menu === "templates" ? null : "templates")}
                  className={`rounded-xl p-2.5 hover:bg-white/80 hover:text-ink ${menu === "templates" ? "bg-white text-ink" : "text-ink/60"}`}
                >
                  <FileText className="size-5" />
                </button>
              </Tooltip>
              <TemplateMenu
                open={menu === "templates"}
                onClose={() => setMenu(null)}
                current={{ subject, body, variables }}
                loadedId={templateId}
                onLoad={loadTemplate}
                onSaved={(t) => set({ templateId: t.id })}
              />
            </div>

            <div className="relative">
              <Tooltip label="Already-emailed people">
                <button
                  onClick={() => setMenu(menu === "skip" ? null : "skip")}
                  className={`rounded-xl p-2.5 hover:bg-white/80 hover:text-ink ${menu === "skip" ? "bg-white text-ink" : "text-ink/60"}`}
                >
                  <UserCheck className="size-5" />
                </button>
              </Tooltip>
              <Popover open={menu === "skip"} onClose={() => setMenu(null)} className="bottom-full left-0 mb-3 w-72">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={skipAlreadySent}
                    onChange={(e) => set({ skipAlreadySent: e.target.checked })}
                    className="mt-0.5 size-4 accent-crimson"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">Skip people I’ve already emailed</span>
                    <span className="mt-0.5 block text-xs text-steel">Anyone with a previously sent email is left out of this batch.</span>
                  </span>
                </label>
              </Popover>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`hidden text-right text-xs font-medium sm:block ${problem ? "text-crimson" : "text-ink/70"}`}>
              {problem ?? (
                <>
                  {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
                  {recipients.length > 1 && delaySeconds > 0 && <> · ~{totalMinutes} min</>}
                </>
              )}
            </span>
            <Button variant="primary" className="px-6 py-2.5 text-[15px]" disabled={!!problem} onClick={openReview}>
              Send
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {findingPeople && (
        <FindPeopleModal initialQuery={company} onClose={() => setFindingPeople(false)} onAdd={addFoundPeople} />
      )}

      {reviewing && (
        <PreviewModal
          draft={reviewing}
          attachments={attachments}
          gmail={gmail}
          onClose={() => setReviewing(null)}
          onSent={(c) => {
            setReviewing(null);
            setCampaign(c);
          }}
        />
      )}

      {campaign && (
        <Modal
          open
          onClose={() => setCampaign(null)}
          title={campaign.name}
          footer={
            <div className="flex justify-between">
              <Link href="/sent" className="text-sm font-medium text-ink underline-offset-2 hover:underline">
                View all sent
              </Link>
              <Button variant="primary" onClick={startNextBatch}>
                Start next company
              </Button>
            </div>
          }
        >
          <div className="p-6">
            <CampaignProgress initial={campaign} />
          </div>
        </Modal>
      )}
    </>
  );
}
