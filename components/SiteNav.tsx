"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/rankings", label: "Rankings" },
  { href: "/stats", label: "Team stats" },
  { href: "/blind", label: "Blind ranking" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <ul className="flex gap-1 text-sm whitespace-nowrap">
        {LINKS.map((l) => {
          const active = path === l.href || path.startsWith(`${l.href}/`);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-2.5 py-1.5 transition ${active ? "bg-ink/[0.06] font-semibold text-ink" : "text-muted hover:text-ink"}`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
