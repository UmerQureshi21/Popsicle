"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { api, type Booked, type BookingPage } from "@/lib/api";
import { describeBooking, slotsByDay } from "@/lib/booking";

const subscribe = () => () => {};

/** The page someone you emailed opens from their booking link. No login: the link is the key. */
export default function BookPage() {
  // The link is read from the address bar, so render only in the browser.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <main className="flex min-h-screen items-start justify-center bg-gradient-to-b from-cloud/60 to-paper px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-16 sm:pt-20">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <Image src="/cold-emailer-logo.png" alt="" width={32} height={29} priority />
          <span className="text-lg font-extrabold tracking-tight text-ink">Popsicle</span>
        </div>
        {mounted && <Booking token={decodeURIComponent(window.location.pathname.split("/")[2] ?? "")} />}
      </div>
    </main>
  );
}

function Booking({ token }: { token: string }) {
  const [page, setPage] = useState<BookingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => {
    api.get<BookingPage>(`/api/book/${encodeURIComponent(token)}`).then(
      (p) => {
        setPage(p);
        setBooked(p.booked);
      },
      (e) => setError(e.message),
    );
  }, [token]);

  const book = async () => {
    if (!picked) return;
    setBooking(true);
    setError(null);
    try {
      setBooked(await api.post<Booked>(`/api/book/${encodeURIComponent(token)}`, { starts_at: picked }));
    } catch (e) {
      setError((e as Error).message);
      setBooking(false);
      setPicked(null);
      // Show what's still open: the time may just have been taken.
      api.get<BookingPage>(`/api/book/${encodeURIComponent(token)}`).then(setPage, () => {});
    }
  };

  const card = "rounded-3xl border border-cloud bg-paper p-6 shadow-sm sm:p-8";

  if (!page) {
    return error ? (
      <div className={card}>
        <h1 className="text-xl font-semibold text-ink">This link isn’t available</h1>
        <p role="alert" className="mt-2 text-sm text-steel">
          {error}
        </p>
      </div>
    ) : (
      <p className="flex items-center gap-2 text-sm text-steel">
        <Loader2 className="size-4 animate-spin" /> Loading open times…
      </p>
    );
  }

  if (booked) {
    return (
      <div className={card}>
        <span className="grid size-11 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
          <CalendarCheck className="size-5" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">You’re booked with {page.host_name}</h1>
        {booked.starts_at && <p className="mt-2 font-medium text-ink">{describeBooking(booked.starts_at, booked.ends_at)}</p>}
        <p className="mt-2 text-sm text-steel">A calendar invite and the Google Meet link are on their way to your email.</p>
      </div>
    );
  }

  const days = slotsByDay(page.slots);
  const shown = days.find((d) => d.key === day) ?? days[0];

  return (
    <div className={card}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Book a call with {page.host_name}</h1>
      <p className="mt-1 text-sm text-steel">
        Hi {page.first_name}, pick a {page.minutes}-minute time that works for you. Times are in your time zone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}).
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-crimson/5 px-4 py-3 text-sm text-crimson">
          {error}
        </p>
      )}

      {days.length === 0 ? (
        <p className="mt-6 text-sm text-steel">There are no open times right now. Reply to the email to find a time.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Days" className="-mx-1 mt-6 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {days.map((d) => (
              <button
                key={d.key}
                role="tab"
                aria-selected={d.key === shown.key}
                onClick={() => {
                  setDay(d.key);
                  setPicked(null);
                }}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium ${d.key === shown.key ? "bg-night text-white" : "bg-cloud text-steel hover:text-ink"}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.slots.map((s) => (
              <button
                key={s.at}
                aria-pressed={picked === s.at}
                onClick={() => setPicked(s.at)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  picked === s.at ? "border-crimson bg-crimson text-white" : "border-steel/30 text-ink hover:border-crimson hover:text-crimson"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={book}
            disabled={!picked || booking}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-crimson py-3 text-sm font-semibold text-white transition-colors enabled:hover:bg-scarlet disabled:cursor-not-allowed disabled:bg-steel/60"
          >
            {booking && <Loader2 className="size-4 animate-spin" />}
            {picked ? `Book ${describeBooking(picked, null)}` : "Pick a time"}
          </button>
        </>
      )}
    </div>
  );
}
