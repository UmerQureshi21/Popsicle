import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "./api";
import { usePaged, useDebounced } from "./paged";
import { pageOf } from "@/test/pages";
import { api, apiError } from "@/test/server";

const numbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function fakeList(path: string, list: () => number[]) {
  return api("get", path, ({ url }) => pageOf(list(), url));
}

describe("usePaged", () => {
  it("loads the first page, then the next ones", async () => {
    const calls = fakeList("/api/things", () => numbers(5));
    const { result } = renderHook(() => usePaged<Page<number>>("/api/things", 2));
    await waitFor(() => expect(result.current.items).toEqual([1, 2]));
    expect(result.current.data?.total).toBe(5);
    expect(calls[0].url.search).toBe("?limit=2&offset=0");

    await act(() => result.current.loadMore());
    expect(result.current.items).toEqual([1, 2, 3, 4]);
    await act(() => result.current.loadMore());
    expect(result.current.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.data?.next_offset).toBeNull();
    await act(() => result.current.loadMore()); // nothing more: no request
    expect(calls).toHaveLength(3);
  });

  it("adds paging to a path that already has a query", async () => {
    const calls = fakeList("/api/things", () => numbers(1));
    const { result } = renderHook(() => usePaged<Page<number>>("/api/things?q=x", 2));
    await waitFor(() => expect(result.current.items).toEqual([1]));
    expect(calls[0].url.search).toBe("?q=x&limit=2&offset=0");
  });

  it("reload fetches everything loaded so far again, in pieces the server allows", async () => {
    let list = numbers(250);
    const calls = fakeList("/api/things", () => list);
    const { result } = renderHook(() => usePaged<Page<number>>("/api/things", 60));
    await waitFor(() => expect(result.current.items).toHaveLength(60));
    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(180);

    list = list.map((n) => n * 10);
    calls.length = 0;
    await act(() => result.current.reload());
    expect(result.current.items).toHaveLength(180);
    expect(result.current.items?.[179]).toBe(1800);
    expect(calls.map((c) => c.url.search)).toEqual(["?limit=100&offset=0", "?limit=80&offset=100"]);
  });

  it("reload stops early when the list got shorter", async () => {
    let list = numbers(4);
    fakeList("/api/things", () => list);
    const { result } = renderHook(() => usePaged<Page<number>>("/api/things", 2));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(() => result.current.loadMore());
    list = [9];
    await act(() => result.current.reload());
    expect(result.current.items).toEqual([9]);
  });

  it("starts again for a new path, ignoring answers for the old one", async () => {
    let release: () => void = () => {};
    api("get", "/api/old", async ({ url }) => {
      if (url.searchParams.get("offset") !== "0") await new Promise<void>((r) => (release = r));
      return pageOf(numbers(4), url);
    });
    fakeList("/api/new", () => [7, 8]);
    const { result, rerender } = renderHook(({ path }) => usePaged<Page<number>>(path, 2), { initialProps: { path: "/api/old" } });
    await waitFor(() => expect(result.current.items).toEqual([1, 2]));
    let more: Promise<void> = Promise.resolve();
    act(() => {
      more = result.current.loadMore();
    });
    rerender({ path: "/api/new" });
    await waitFor(() => expect(result.current.items).toEqual([7, 8]));
    await act(async () => {
      release();
      await more;
    });
    expect(result.current.items).toEqual([7, 8]);
  });

  it("an old path's first page arriving late is ignored too", async () => {
    let release: () => void = () => {};
    let started = false;
    api("get", "/api/slow", async ({ url }) => {
      started = true;
      await new Promise<void>((r) => (release = r));
      return pageOf([1], url);
    });
    fakeList("/api/fast", () => [2]);
    const { result, rerender } = renderHook(({ path }) => usePaged<Page<number>>(path), { initialProps: { path: "/api/slow" } });
    await waitFor(() => expect(started).toBe(true));
    rerender({ path: "/api/fast" });
    await waitFor(() => expect(result.current.items).toEqual([2]));
    await act(async () => release());
    expect(result.current.items).toEqual([2]);
  });

  it("reports errors, for the first page, more and reload", async () => {
    apiError("get", "/api/broken", 500, "Database is down");
    const { result } = renderHook(() => usePaged<Page<number>>("/api/broken"));
    await waitFor(() => expect(result.current.error).toBe("Database is down"));
    expect(result.current.items).toBeNull();

    let fail = false;
    api("get", "/api/flaky", ({ url }) => (fail ? Response.json({ detail: "Gone" }, { status: 500 }) : pageOf(numbers(3), url)));
    const flaky = renderHook(() => usePaged<Page<number>>("/api/flaky", 2)).result;
    await waitFor(() => expect(flaky.current.items).toEqual([1, 2]));
    fail = true;
    await act(() => flaky.current.loadMore());
    expect(flaky.current.error).toBe("Gone");
    expect(flaky.current.loadingMore).toBe(false);
    await act(() => flaky.current.reload());
    expect(flaky.current.error).toBe("Gone");
    expect(flaky.current.items).toEqual([1, 2]);
  });

  it("edits loaded items in place", async () => {
    fakeList("/api/things", () => numbers(2));
    const { result } = renderHook(() => usePaged<Page<number>>("/api/things"));
    act(() => result.current.edit((items) => items.map((n) => n * 2))); // nothing loaded yet: no-op
    await waitFor(() => expect(result.current.items).toEqual([1, 2]));
    act(() => result.current.edit((items) => items.map((n) => n * 2)));
    expect(result.current.items).toEqual([2, 4]);
  });
});

describe("useDebounced", () => {
  it("settles once the value stops changing", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ v }) => useDebounced(v, 100), { initialProps: { v: "a" } });
      rerender({ v: "ab" });
      rerender({ v: "abc" });
      expect(result.current).toBe("a");
      act(() => vi.advanceTimersByTime(100));
      expect(result.current).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });
});
