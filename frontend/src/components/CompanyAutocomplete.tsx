"use client";

import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, Loader2 } from "lucide-react";
import { api, type CompanySuggestion } from "@/lib/api";

/** A company's logo from Hunter, falling back to a building icon. */
export function CompanyLogo({ domain, size = 20 }: { domain?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return (
      <span className="grid shrink-0 place-items-center rounded-md bg-cloud text-steel" style={{ width: size, height: size }}>
        <Building2 style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  }
  return (
    <Image
      src={`https://logos.hunter.io/${domain}`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md bg-white object-contain"
    />
  );
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** A suggestion was chosen (click, or Enter on a highlighted one). */
  onPick: (s: CompanySuggestion) => void;
  /** Enter with no suggestion highlighted: use the typed text as-is. */
  onSubmitRaw?: (text: string) => void;
  onBackspaceEmpty?: () => void;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  leading?: ReactNode;
};

const DEBOUNCE_MS = 250;

/**
 * A text box that suggests companies from Hunter as you type, like Hunter's own search:
 * "Harvey" offers harvey.ai, harvey.net… with logos and how many people Hunter has at each.
 */
export default function CompanyAutocomplete({
  value,
  onChange,
  onPick,
  onSubmitRaw,
  onBackspaceEmpty,
  onPaste,
  placeholder,
  ariaLabel,
  autoFocus,
  className = "",
  leading,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1: nothing highlighted, Enter keeps the typed text
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  // Fetch suggestions shortly after typing stops; ignore answers to older queries.
  useEffect(() => {
    const q = value.trim();
    const id = ++requestId.current;
    if (q.length < 2) {
      const t = setTimeout(() => {
        if (id === requestId.current) setSuggestions([]);
      });
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<CompanySuggestion[]>(`/api/people-search/suggest?q=${encodeURIComponent(q)}`);
        if (id === requestId.current) {
          // Biggest companies first, like Hunter's own search.
          const sorted = [...res].sort((a, b) => (b.email_count ?? 0) - (a.email_count ?? 0));
          setSuggestions(sorted);
          // Only pre-highlight when the typed text is exactly a domain. A typed name stays as-is on Enter
          // (Hunter resolves it), so a half-typed "Harv" can't silently become some tiny company.
          const typed = q.toLowerCase();
          setActive(sorted.findIndex((s) => s.domain.toLowerCase() === typed));
        }
      } catch {
        if (id === requestId.current) setSuggestions([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const showList = open && value.trim().length >= 2 && suggestions.length > 0;

  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showList]);

  const pick = (s: CompanySuggestion) => {
    onPick(s);
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && showList) {
      e.preventDefault();
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && showList) {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      if (showList && suggestions[active]) {
        e.preventDefault();
        pick(suggestions[active]);
      } else if (onSubmitRaw && value.trim()) {
        e.preventDefault();
        onSubmitRaw(value.trim());
      }
    } else if (e.key === "Escape" && showList) {
      e.stopPropagation(); // close the list, not a surrounding modal
      setOpen(false);
    } else if (e.key === "Backspace" && !value && onBackspaceEmpty) {
      onBackspaceEmpty();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={`relative flex min-w-0 items-center gap-2 ${className}`}>
      {leading}
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={listId}
        aria-expanded={showList}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-steel"
      />
      {loading && <Loader2 className="size-4 shrink-0 animate-spin text-steel" />}

      {showList &&
        rect &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching companies"
            style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 280) }}
            className="animate-fade-up fixed z-[60] max-h-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-2xl border border-cloud bg-white p-1.5 shadow-[0_20px_50px_-12px_rgba(43,45,66,0.35)]"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.domain}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => pick(s)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${i === active ? "bg-cloud" : ""}`}
              >
                <CompanyLogo domain={s.domain} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{s.name || s.domain}</span>
                  <span className="block truncate text-xs text-steel">{s.domain}</span>
                </span>
                {s.email_count != null && (
                  <span className="shrink-0 text-xs text-steel">
                    {s.email_count.toLocaleString()} {s.email_count === 1 ? "person" : "people"}
                  </span>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
