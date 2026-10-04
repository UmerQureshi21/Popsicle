"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Coins, Mail, Send, UserSearch, Users } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { useHunterStatus } from "@/lib/credits";
import { formatDate } from "@/lib/format";

const TABS = [
  { href: "/compose", label: "Compose", icon: Mail },
  { href: "/find", label: "Find people", icon: UserSearch },
  { href: "/sent", label: "Sent", icon: Send },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
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
        <span className="hidden lg:inline">credits</span>
      </Link>
    </Tooltip>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const onCompose = pathname === "/compose";

  // The landing page has its own header.
  if (pathname === "/") return null;

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4">
      <nav
        className={`flex w-full max-w-5xl items-center justify-between gap-2 rounded-2xl border px-2 py-2 shadow-sm backdrop-blur-xl sm:px-3 ${
          onCompose ? "border-white/50 bg-white/70" : "border-cloud bg-white/90"
        }`}
      >
        <Link href="/compose" className="flex shrink-0 items-center gap-2 px-1.5 sm:px-2" aria-label="Popsicle">
          <Image src="/cold-emailer-logo.png" alt="" width={34} height={31} priority />
          <span className="hidden text-[17px] font-bold tracking-tight text-ink sm:inline">Popsicle</span>
        </Link>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <CreditsPill />
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {TABS.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-label={label}
                    title={label}
                    className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
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
        </div>
      </nav>
    </header>
  );
}
