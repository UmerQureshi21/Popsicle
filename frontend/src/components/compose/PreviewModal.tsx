"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Paperclip, Send } from "lucide-react";
import { API_URL, api, type Attachment, type CampaignDetail, type CampaignDraft, type GmailStatus, type Preview } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Avatar, Button, Modal, StatusBadge } from "@/components/ui";

type Props = {
  draft: CampaignDraft;
  attachments: Attachment[];
  gmail: GmailStatus | null;
  onClose: () => void;
  onSent: (campaign: CampaignDetail) => void;
};

export default function PreviewModal({ draft, attachments, gmail, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.post<Preview>("/api/campaigns/preview", draft).then(setPreview, (e) => setError(e.message));
  }, [draft]);

  const item = preview?.items[selected];
  const canSend = !!preview && preview.ready > 0 && preview.invalid === 0 && !!gmail?.connected && !sending;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      onSent(await api.post<CampaignDetail>("/api/campaigns", draft));
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Review before sending"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-steel">
            {preview ? (
              <>
                <span className="font-semibold text-ink">{preview.ready}</span> ready
                {preview.already_sent > 0 && <> · {preview.already_sent} already emailed (skipped)</>}
                {preview.invalid > 0 && <span className="text-crimson"> · {preview.invalid} need fixing</span>}
                <> · ~{Math.round(draft.delay_seconds)}s between emails</>
              </>
            ) : (
              "Rendering…"
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Back to editing</Button>
            <Button variant="primary" onClick={send} disabled={!canSend}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send {preview?.ready ?? ""} email{preview?.ready === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      }
    >
      {gmail && !gmail.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-crimson/15 bg-crimson/5 px-4 py-3 text-sm text-crimson sm:px-6">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {gmail.credentials_file_present
              ? "Connect your Gmail account before sending."
              : "Gmail isn't set up yet: add backend/credentials.json (see README), then connect."}
          </span>
          {gmail.credentials_file_present && (
            <a href={`${API_URL}/api/gmail/connect`} className="font-semibold underline underline-offset-2">
              Connect Gmail
            </a>
          )}
        </div>
      )}
      {error && <div className="border-b border-crimson/15 bg-crimson/5 px-4 py-3 text-sm text-crimson sm:px-6">{error}</div>}

      {!preview ? (
        <div className="grid h-80 place-items-center text-steel">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <div className="grid min-h-[28rem] md:grid-cols-[260px_1fr]">
          <ul className="hidden max-h-[60vh] overflow-y-auto border-r border-cloud p-2 md:block">
            {preview.items.map((it, i) => (
              <li key={i}>
                <button
                  onClick={() => setSelected(i)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${
                    i === selected ? "bg-cloud" : "hover:bg-cloud/60"
                  }`}
                >
                  <Avatar name={it.values.full_name || it.to_email || "?"} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {it.values.full_name || it.to_email || "(no email)"}
                    </span>
                    <span className="block truncate text-xs text-steel">{it.to_email}</span>
                  </span>
                  {it.status !== "ready" && <StatusBadge status={it.status} />}
                </button>
              </li>
            ))}
          </ul>

          {item && (
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-cloud px-4 py-3 text-sm sm:px-6">
                <div className="min-w-0">
                  {/* On phones the recipient list is hidden, so name who this one is for */}
                  {item.values.full_name && <p className="truncate font-semibold text-ink md:hidden">{item.values.full_name}</p>}
                  <p className="truncate">
                    <span className="text-steel">To </span>
                    <span className="font-medium text-ink">{item.to_email}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-steel">
                  <span className="mr-1 text-xs">
                    {selected + 1} / {preview.items.length}
                  </span>
                  <button
                    className="rounded-lg p-1 hover:bg-cloud disabled:opacity-30"
                    disabled={selected === 0}
                    onClick={() => setSelected(selected - 1)}
                    aria-label="Previous"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    className="rounded-lg p-1 hover:bg-cloud disabled:opacity-30"
                    disabled={selected === preview.items.length - 1}
                    onClick={() => setSelected(selected + 1)}
                    aria-label="Next"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
              {item.status === "invalid" && (
                <div className="mx-4 mt-4 rounded-xl bg-crimson/5 px-4 py-2.5 text-sm text-crimson sm:mx-6">{item.issues.join(" · ")}</div>
              )}
              {item.status === "already_sent" && (
                <div className="mx-4 mt-4 rounded-xl bg-cloud px-4 py-2.5 text-sm text-ink/80 sm:mx-6">
                  You already emailed this person on {formatDate(item.last_sent_at)}. They’ll be skipped.
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <h3 className="mb-4 text-xl font-semibold text-ink">{item.subject}</h3>
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink/90">{item.body}</div>
                {attachments.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {attachments.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 rounded-lg bg-cloud px-2.5 py-1.5 text-xs text-ink">
                        <Paperclip className="size-3.5 text-steel" />
                        {a.filename}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
