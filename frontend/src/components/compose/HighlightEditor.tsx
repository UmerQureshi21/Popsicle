"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { PLACEHOLDER } from "@/lib/tuples";

export type EditorHandle = {
  insert: (text: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  known: Set<string>;
  placeholder?: string;
  singleLine?: boolean;
  className?: string;
  minHeight?: number;
  onFocus?: () => void;
  ariaLabel: string;
  ref?: Ref<EditorHandle>;
};

function highlight(text: string, known: Set<string>): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const i = m.index ?? 0;
    parts.push(text.slice(last, i));
    parts.push(
      <span key={i} className={known.has(m[1].toLowerCase()) ? "placeholder-chip" : "placeholder-chip-unknown"}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  // Trailing space keeps the backdrop as tall as the textarea when text ends in a newline.
  parts.push(text.slice(last) + " ");
  return parts;
}

/**
 * A textarea whose {{placeholders}} are highlighted. The real textarea sits on top with
 * transparent text (so caret, selection and editing are native); an identically laid
 * out div behind it renders the coloured text.
 */
export default function HighlightEditor({
  value,
  onChange,
  known,
  placeholder,
  singleLine,
  className = "",
  minHeight,
  onFocus,
  ariaLabel,
  ref,
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, minHeight ?? 0)}px`;
  }, [value, minHeight]);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    insert: (text: string) => {
      const el = ta.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + text + value.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + text.length, start + text.length);
      });
    },
  }));

  return (
    <div className={`relative ${className}`}>
      <div aria-hidden className="editor-layer pointer-events-none absolute inset-0 overflow-hidden text-ink">
        {highlight(value, known)}
      </div>
      <textarea
        ref={ta}
        aria-label={ariaLabel}
        value={value}
        rows={1}
        spellCheck
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, " ") : e.target.value)}
        onKeyDown={(e) => singleLine && e.key === "Enter" && e.preventDefault()}
        className="editor-layer relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-ink outline-none placeholder:text-steel/70"
      />
    </div>
  );
}
