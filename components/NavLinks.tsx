"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/map", label: "Map" },
  { href: "/compare", label: "Compare" },
  { href: "/alerts", label: "Alerts" },
  { href: "/assistant", label: "Assistant" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="flex gap-1 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/city/") : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block rounded-lg px-3 py-1.5 font-medium transition-colors ${active ? "bg-surface-2 text-text underline decoration-2 underline-offset-[6px]" : "text-muted hover:bg-surface-2 hover:text-text"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
