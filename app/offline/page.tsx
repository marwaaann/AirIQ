import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Shown by the service worker for navigations to pages it has not saved
 * while there is no connection. Static, so it is precached on install.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-12" data-testid="offline-page">
      <h1 className="text-3xl font-bold tracking-tight">You&rsquo;re offline</h1>
      <p className="text-muted">
        This page hasn&rsquo;t been saved for offline use yet, and there&rsquo;s no connection to load it. Pages you have opened before still work, showing
        their last saved data with its time, never as live data.
      </p>
      <p className="text-sm text-muted">Live air-quality readings, forecasts and the assistant need a connection.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className="inline-flex h-10 items-center rounded-lg bg-text px-4 text-sm font-semibold text-bg">
          Go to the dashboard
        </Link>
        <a href="" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
          Try again
        </a>
      </div>
    </div>
  );
}
