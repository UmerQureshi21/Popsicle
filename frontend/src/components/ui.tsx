"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { CampaignStatus, EmailStatus } from "@/lib/api";
import { initials } from "@/lib/format";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-up flex max-h-[88vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-xl"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-cloud px-4 py-4 sm:px-6">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-steel hover:bg-cloud hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-cloud bg-cloud/40 px-4 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

export function Popover({
  open,
  onClose,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Defer so the click that opened the popover doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`animate-fade-up absolute z-30 rounded-2xl border border-cloud bg-white p-4 shadow-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 hidden whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover/tip:block">
        {label}
      </span>
    </span>
  );
}

const PALETTE = ["#d90429", "#2b2d42", "#8d99ae", "#ef233c", "#5c677d"];

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: PALETTE[h % PALETTE.length] }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-crimson/10 text-crimson ring-crimson/25",
  invalid: "bg-crimson/10 text-crimson ring-crimson/25",
  interrupted: "bg-crimson/10 text-crimson ring-crimson/25",
  sending: "bg-ink text-white ring-ink",
  queued: "bg-cloud text-ink ring-steel/30",
  pending: "bg-cloud text-ink ring-steel/30",
  skipped: "bg-white text-steel ring-steel/30",
  already_sent: "bg-white text-steel ring-steel/30",
  cancelled: "bg-white text-steel ring-steel/30",
};

const STATUS_LABELS: Record<string, string> = { already_sent: "already emailed" };

export function StatusBadge({ status }: { status: EmailStatus | CampaignStatus | "ready" | "invalid" | "already_sent" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_STYLES[status] ?? STATUS_STYLES.pending
      }`}
    >
      {status === "sending" && <span className="size-1.5 animate-pulse rounded-full bg-scarlet" />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-crimson text-white shadow-sm hover:bg-scarlet disabled:bg-steel/60",
    secondary: "border border-steel/30 bg-white text-ink hover:bg-cloud disabled:text-steel",
    ghost: "text-ink/70 hover:bg-cloud hover:text-ink disabled:text-steel",
    danger: "text-crimson hover:bg-crimson/10 disabled:text-steel",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-steel/40 bg-white px-6 py-16 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-cloud text-steel">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-steel">{children}</div>}
    </div>
  );
}
