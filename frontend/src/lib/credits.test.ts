import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { api, apiError } from "@/test/server";
import { hunterStatus } from "@/test/fixtures";
import { creditsChanged, creditsText, searchCost, useHunterStatus } from "./credits";

describe("searchCost", () => {
  it.each([
    [0, 1],
    [5, 1],
    [10, 1],
    [11, 2],
    [25, 3],
  ])("%d people -> %d credits at most", (people, cost) => expect(searchCost(people)).toBe(cost));
});

it("creditsText", () => {
  expect(creditsText(1)).toBe("1 credit");
  expect(creditsText(3)).toBe("3 credits");
});

describe("useHunterStatus", () => {
  it("loads the status and reloads it when credits change", async () => {
    let remaining = 40;
    const calls = api("get", "/api/people-search/status", () => hunterStatus({ credits_remaining: remaining }));
    const { result } = renderHook(() => useHunterStatus());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.credits_remaining).toBe(40));

    remaining = 39;
    act(() => creditsChanged());
    await waitFor(() => expect(result.current?.credits_remaining).toBe(39));
    expect(calls).toHaveLength(2);
  });

  it("stays null when the request fails", async () => {
    const calls = apiError("get", "/api/people-search/status", 500);
    const { result } = renderHook(() => useHunterStatus());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current).toBeNull();
  });
});
