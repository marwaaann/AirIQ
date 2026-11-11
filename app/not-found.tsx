import type { Metadata } from "next";
import Link from "next/link";

import { CitySearch } from "@/components/CitySearch";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown routes and invalid city links (e.g. /city/not-a-place). */
export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">
        That link doesn&rsquo;t match a page or a valid city. City links look like <code className="font-mono">/city/delhi-28.652-77.231</code>{" "}
        (a name followed by latitude and longitude).
      </p>
      <div className="w-full max-w-md text-left">
        <CitySearch label="Search for a city instead" />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
          Go to the dashboard
        </Link>
        <Link href="/map" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
          Open the map
        </Link>
      </div>
    </section>
  );
}
