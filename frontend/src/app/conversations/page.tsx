"use client";

import { useSyncExternalStore } from "react";
import BookingHours from "@/components/conversations/BookingHours";
import Conversations from "@/components/conversations/Conversations";
import PageShell from "@/components/PageShell";

const subscribe = () => () => {};

export default function ConversationsPage() {
  // Reads the address bar on load (a person to open, Gmail reconnect results), so render only in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <PageShell
      title="Inbox"
      subtitle="Everyone you’ve emailed and what they said back. Set up a Google Meet in one click."
      actions={mounted && <BookingHours />}
    >
      {mounted && <Conversations />}
    </PageShell>
  );
}
