"use client";

import { useSyncExternalStore } from "react";
import LookupPerson from "@/components/lookup/LookupPerson";
import PageShell from "@/components/PageShell";

const subscribe = () => () => {};

export default function LookupPage() {
  // Recent lookups are kept in localStorage, so render only in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <PageShell title="Look up a person" subtitle="Find someone’s email from their name and company, even when Hunter doesn’t list them.">
      {mounted && <LookupPerson />}
    </PageShell>
  );
}
