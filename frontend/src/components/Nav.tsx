"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Mail, Send, UserSearch, Users } from "lucide-react";

const TABS = [
  { href: "/compose", label: "Compose", icon: Mail },
  { href: "/find", label: "Find people", icon: UserSearch },
  { href: "/sent", label: "Sent", icon: Send },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
];

export default function Nav() {
  const pathname = usePathname();
  const onCompose = pathname === "/compose";

  // The landing page has its own header.
  if (pathname === "/") return null;

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4">
      <nav
        className={`flex w-full max-w-5xl items-center justify-between rounded-2xl border px-3 py-2 shadow-sm backdrop-blur-xl ${
          onCompose ? "border-white/50 bg-white/70" : "border-cloud bg-white/90"
        }`}
      >
        <Link href="/compose" className="flex items-center gap-2 px-2">
          <Image src="/cold-emailer-logo.png" alt="" width={34} height={31} priority />
          <span className="text-[17px] font-bold tracking-tight text-ink">Popsicle</span>
        </Link>
        <ul className="flex items-center gap-1">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-ink text-white" : "text-ink/70 hover:bg-cloud hover:text-ink"
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
