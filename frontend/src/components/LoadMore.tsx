"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

/**
 * The end of a long list: loads the next page by itself when it scrolls into view, and offers
 * a button too (for keyboards, and browsers without IntersectionObserver).
 */
export default function LoadMore({ shown, total, hasMore, loading, onMore, className = "" }: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useEffect(() => {
    latest.current = onMore;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);

  if (!hasMore) return null;
  return (
    <div ref={ref} className={`flex items-center justify-center gap-3 py-4 text-sm text-steel ${className}`}>
      <span>
        Showing {shown} of {total}
      </span>
      <button
        onClick={onMore}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-xl border border-steel/30 bg-paper px-3 py-1.5 font-medium text-ink hover:bg-cloud disabled:text-steel"
      >
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
