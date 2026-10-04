"use client";

import { useSyncExternalStore } from "react";
import FindPeople from "@/components/find/FindPeople";
import PageShell from "@/components/PageShell";

const subscribe = () => () => {};

export default function FindPeoplePage() {
  // Searches are kept in localStorage, so render only in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <PageShell title="Find people" subtitle="Find people with a given job title at the companies you’re targeting, then email them.">
      {mounted && <FindPeople />}
    </PageShell>
  );
}
