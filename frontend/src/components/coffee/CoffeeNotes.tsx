"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { FORMAT_TIP, NOTES_HINT, coffeeChatUrl } from "@/lib/coffeeChat";

export const SAVE_DELAY_MS = 600;

type Saving = "saved" | "saving" | "unsaved" | "failed";

/** Your notepad for one person: why you're reaching out and your questions. It saves as you
 * type, and becomes the second half of their coffee chat sheet (About me comes first). */
export default function CoffeeNotes({
  contactId,
  initial,
  onSaved,
  className = "",
}: {
  contactId: number;
  initial: string;
  onSaved?: (notes: string) => void;
  className?: string;
}) {
  const [notes, setNotes] = useState(initial);
  const [state, setState] = useState<Saving>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onSaved);
  useEffect(() => {
    latest.current = onSaved;
  }, [onSaved]);

  const save = async (text: string) => {
    setState("saving");
    try {
      await api.patch(`/api/contacts/${contactId}`, { notes: text });
      setState("saved");
      latest.current?.(text);
    } catch {
      setState("failed");
    }
  };

  const change = (text: string) => {
    setNotes(text);
    setState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), SAVE_DELAY_MS);
  };

  // Leaving with a change not yet saved (closing the notes, picking someone else) saves it straight away.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    pending.current = state === "unsaved" ? notes : null;
  }, [state, notes]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) api.patch(`/api/contacts/${contactId}`, { notes: pending.current }).catch(() => {});
    },
    [contactId],
  );

  const ready = state === "saved";
  const linkClass = `inline-flex items-center gap-1.5 rounded-xl border border-steel/30 bg-paper px-3 py-1.5 text-sm font-medium text-ink hover:bg-cloud ${
    ready ? "" : "pointer-events-none opacity-50"
  }`;
  return (
    <div className={`flex min-h-0 flex-col gap-3 ${className}`}>
      <textarea
        value={notes}
        onChange={(e) => change(e.target.value)}
        placeholder={NOTES_HINT}
        aria-label="Coffee chat notes"
        maxLength={20000}
        className="min-h-64 flex-1 resize-y rounded-2xl border border-steel/30 bg-paper p-4 text-sm leading-relaxed text-ink outline-none placeholder:text-steel/70 focus:border-scarlet focus:ring-4 focus:ring-scarlet/10"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-steel">
          {state === "failed" ? (
            <span className="text-crimson">Couldn’t save. Check your connection; your text is still here.</span>
          ) : state === "saved" ? (
            FORMAT_TIP
          ) : (
            "Saving…"
          )}
        </p>
        <a href={coffeeChatUrl(contactId)} target="_blank" rel="noreferrer" aria-disabled={!ready} className={linkClass}>
          <FileText className="size-4" /> Preview PDF
        </a>
        <a href={coffeeChatUrl(contactId, true)} aria-disabled={!ready} className={linkClass}>
          <Download className="size-4" /> Download PDF
        </a>
      </div>
    </div>
  );
}
