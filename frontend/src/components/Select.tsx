"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption<T extends string | number> = { value: T; label: string; hint?: string };

type Props<T extends string | number> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  ariaLabel: string;
  className?: string;
};

type Position = { left?: number; right?: number; minWidth: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 6;
const MAX_HEIGHT = 288;
const MAX_WIDTH = 320;

/**
 * A styled replacement for <select>. The menu renders in a portal with fixed positioning so it
 * isn't clipped by scrolling containers (like modals), and opens upward when there's no room below.
 */
export default function Select<T extends string | number>({ value, onChange, options, ariaLabel, className = "" }: Props<T>) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<Position | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    // At least as wide as the button, growing to fit long options. Near the right edge, align right edges.
    const minWidth = Math.max(r.width, 160);
    const horizontal = r.left + MAX_WIDTH > window.innerWidth ? { right: window.innerWidth - r.right } : { left: r.left };
    if (below >= Math.min(MAX_HEIGHT, 160) || below >= above) {
      setPos({ ...horizontal, minWidth, top: r.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) });
    } else {
      setPos({ ...horizontal, minWidth, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) });
    }
  }, []);

  const openMenu = () => {
    setActive(selectedIndex);
    place();
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (i: number) => {
    onChange(options[i].value);
    close();
  };

  // Keep the menu attached to the button while the page or a modal scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const action = keys[e.key];
    if (!action) return;
    if (e.key !== "Tab") e.preventDefault();
    e.stopPropagation(); // don't let Escape also close a surrounding modal
    action();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onButtonKey}
        className={`flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-sm text-ink transition-colors outline-none hover:border-steel/50 focus-visible:border-scarlet focus-visible:ring-4 focus-visible:ring-scarlet/10 ${
          open ? "border-scarlet ring-4 ring-scarlet/10" : "border-steel/30"
        } ${className}`}
      >
        <span className="truncate">
          {selected?.label}
          {selected?.hint && <span className="ml-1.5 text-steel">{selected.hint}</span>}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-steel transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={`${id}-opt-${active}`}
            onKeyDown={onListKey}
            style={{ ...pos, width: "max-content", maxWidth: `min(${MAX_WIDTH}px, calc(100vw - 16px))` }}
            className="animate-fade-up fixed z-[60] overflow-y-auto rounded-2xl border border-cloud bg-white p-1.5 shadow-[0_20px_50px_-12px_rgba(43,45,66,0.35)] outline-none"
          >
            {options.map((o, i) => {
              const isSelected = i === selectedIndex;
              return (
                <li
                  key={String(o.value)}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the list
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                    i === active ? "bg-cloud" : ""
                  } ${isSelected ? "font-semibold text-ink" : "text-ink/80"}`}
                >
                  <span className="truncate">
                    {o.label}
                    {o.hint && <span className="ml-1.5 font-normal text-steel">{o.hint}</span>}
                  </span>
                  {isSelected && <Check className="size-4 shrink-0 text-crimson" />}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
