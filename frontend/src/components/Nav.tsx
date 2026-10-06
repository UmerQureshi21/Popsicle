"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AtSign, Building2, Coins, Inbox, LogOut, Mail, Send, UserSearch, Users } from "lucide-react";
import { Avatar, Popover, Tooltip } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useHunterStatus } from "@/lib/credits";
import { formatDate } from "@/lib/format";

const TABS = [
  { href: "/compose", label: "Compose", short: "Compose", icon: Mail },
  { href: "/find", label: "Find people", short: "Find", icon: UserSearch },
  { href: "/lookup", label: "Look up", short: "Look up", icon: AtSign },
  { href: "/sent", label: "Sent", short: "Sent", icon: Send },
  { href: "/conversations", label: "Inbox", short: "Inbox", icon: Inbox },
  { href: "/contacts", label: "Contacts", short: "People", icon: Users },
  { href: "/companies", label: "Companies", short: "Firms", icon: Building2 },
];

/** Hunter credits left this month; refreshes after every search. */
function CreditsPill() {
  const status = useHunterStatus();
  if (!status?.configured || status.credits_remaining == null) return null;
  const low = status.credits_remaining <= 5;
  const label = [
    `Hunter credits left this month: ${status.credits_remaining}${status.credits_total != null ? ` of ${status.credits_total}` : ""}`,
    status.reset_date && `resets ${formatDate(status.reset_date)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip label={label}>
      <Link
        href="/find"
        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-cloud sm:px-3 ${
          low ? "text-crimson" : "text-ink/70"
        }`}
        aria-label={label}
      >
        <Coins className="size-4" />
        {status.credits_remaining}
      </Link>
    </Tooltip>
  );
}

/** Who's logged in, with a log-out option. Hidden when nobody is (e.g. running locally). */
function AccountMenu() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!me?.user) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account"
        aria-expanded={open}
        className="flex items-center rounded-full p-1 transition-colors hover:bg-cloud"
      >
        <Avatar name={me.user.name || me.user.email} size={28} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="top-full right-0 mt-2 w-64 p-2">
        <p className="px-3 pt-1.5 text-xs text-steel">Signed in as</p>
        <p className="truncate px-3 pb-2 text-sm font-medium text-ink">{me.user.email}</p>
        <button
          onClick={() => {
            setOpen(false);
            logout();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-cloud"
        >
          <LogOut className="size-4 text-steel" /> Log out
        </button>
      </Popover>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const onCompose = pathname === "/compose";

  // The landing and login pages have their own layout.
  if (pathname === "/" || pathname === "/login") return null;

  return (
    <>
      {/* Top bar: a floating pill from tablet up; a slim full-width bar on phones */}
      <header className="fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] sm:flex sm:justify-center sm:px-4 sm:pt-4">
        <nav
          aria-label="Main"
          className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur-xl sm:max-w-5xl sm:rounded-2xl sm:border sm:px-3 sm:shadow-sm ${
            onCompose ? "border-cloud bg-white/90 sm:border-white/50 sm:bg-white/70" : "border-cloud bg-white/90"
          }`}
        >
          <Link href="/compose" className="flex shrink-0 items-center gap-2 px-1.5 sm:px-2" aria-label="Popsicle">
            <Image src="/cold-emailer-logo.png" alt="" width={34} height={31} priority />
            <span className="text-[17px] font-bold tracking-tight text-ink">Popsicle</span>
          </Link>
          <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            <CreditsPill />
            <ul className="hidden items-center gap-1 sm:flex">
              {TABS.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-label={label}
                      title={label}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                        active ? "bg-ink text-white" : "text-ink/70 hover:bg-cloud hover:text-ink"
                      }`}
                    >
                      <Icon className="size-4" />
                      <span className="hidden lg:inline">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <AccountMenu />
          </div>
        </nav>
      </header>

      {/* Phones: tabs live in a bottom bar, like a native app */}
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-cloud bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      >
        <ul className="grid h-[60px] grid-cols-7">
          {TABS.map(({ href, short, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium tracking-tight transition-colors ${
                    active ? "text-crimson" : "text-ink/55 active:text-ink"
                  }`}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                  {short}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
