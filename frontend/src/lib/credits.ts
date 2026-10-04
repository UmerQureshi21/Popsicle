"use client";

import { useEffect, useState } from "react";
import { api, type HunterStatus } from "./api";

const EVENT = "popsicle:hunter-credits-changed";

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
