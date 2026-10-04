"use client";

import { useEffect, useState } from "react";
import { api, type HunterStatus } from "./api";

const EVENT = "popsicle:hunter-credits-changed";

/**
 * Most credits a company search can use. Hunter: Domain Search costs "1 credit per 1–10 emails",
 * nothing if no emails are found, and nothing for a repeat of the same search in the billing period.
 * https://help.hunter.io/en/articles/1911617-how-do-credits-work-in-hunter
 */
export function searchCost(people: number): number {
  return Math.max(1, Math.ceil(people / 10));
}

export function creditsText(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

/** Call after anything that may have spent Hunter credits, so every credit counter refreshes. */
export function creditsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Hunter account status (credits left, reset date), refetched whenever creditsChanged() fires. */
export function useHunterStatus(): HunterStatus | null {
  const [status, setStatus] = useState<HunterStatus | null>(null);
  useEffect(() => {
    const load = () => api.get<HunterStatus>("/api/people-search/status").then(setStatus, () => {});
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, []);
  return status;
}
