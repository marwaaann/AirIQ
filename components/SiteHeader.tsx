import Link from "next/link";

import { AlertBell } from "@/components/alerts/AlertBell";
import { CitySearch } from "@/components/CitySearch";
import { LogoMark } from "@/components/icons";
import { NavLinks } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pt-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-md font-bold tracking-tight text-brand" aria-label="AirIQ home">
          <LogoMark />
          <span className="text-lg text-text">
            Air<span className="text-brand">IQ</span>
          </span>
        </Link>
        <div className="min-w-0 flex-1 sm:max-w-sm md:ml-4">
          <CitySearch />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AlertBell />
          <ThemeToggle />
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl px-2 sm:px-4">
        <NavLinks />
      </div>
    </header>
  );
}
