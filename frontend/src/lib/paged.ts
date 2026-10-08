"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Page } from "./api";

export const PAGE_SIZE = 30;
const MAX_LIMIT = 100; // the most the backend returns at once

function withPage(path: string, offset: number, limit: number): string {
  return `${path}${path.includes("?") ? "&" : "?"}limit=${limit}&offset=${offset}`;
}

/**
 * A long list, a page at a time. Changing `path` (a new search or filter) starts again from the
 * first page; `loadMore` adds the next one; `reload` fetches everything loaded so far again
 * (after a change, or to keep it fresh). Answers for an older path are ignored.
 */
export function usePaged<P extends Page<unknown>>(path: string, pageSize = PAGE_SIZE) {
  const [data, setData] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const current = useRef(path);
  const loaded = useRef(0);

  const show = useCallback((p: P) => {
    loaded.current = p.items.length;
    setData(p);
    setError(null);
  }, []);

  useEffect(() => {
    current.current = path;
    let stale = false;
    api.get<P>(withPage(path, 0, pageSize)).then(
      (p) => !stale && show(p),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [path, pageSize, show]);

  const loadMore = useCallback(async () => {
    const at = data?.next_offset;
    if (at == null || loadingMore) return;
    const asked = path;
    setLoadingMore(true);
    try {
      const next = await api.get<P>(withPage(asked, at, pageSize));
      if (current.current !== asked) return;
      setData((prev) => {
        const merged = { ...next, items: [...(prev?.items ?? []), ...next.items] } as P;
        loaded.current = merged.items.length;
        return merged;
      });
    } catch (e) {
      if (current.current === asked) setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [data?.next_offset, loadingMore, path, pageSize]);

  const reload = useCallback(async () => {
    const asked = path;
    const want = Math.max(pageSize, loaded.current);
    try {
      let page = await api.get<P>(withPage(asked, 0, Math.min(want, MAX_LIMIT)));
      const items = [...page.items];
      while (items.length < want && page.next_offset != null) {
        page = await api.get<P>(withPage(asked, page.next_offset, Math.min(want - items.length, MAX_LIMIT)));
        items.push(...page.items);
      }
      if (current.current === asked) show({ ...page, items } as P);
    } catch (e) {
      if (current.current === asked) setError((e as Error).message);
    }
  }, [path, pageSize, show]);

  /** Change loaded items in place (e.g. right after an edit), before a reload confirms it. */
  const edit = useCallback((fn: (items: P["items"]) => P["items"]) => setData((prev) => (prev ? { ...prev, items: fn(prev.items) } : prev)), []);

  return { data, items: (data?.items ?? null) as P["items"] | null, error, loadingMore, loadMore, reload, edit };
}

/** `value`, once it has stopped changing for `ms` (for search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
