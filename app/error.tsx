"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary. Shows a plain message and two ways out
 * (try again, or go home). Server errors arrive with only a digest, so no
 * internal details reach the page.
 */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  useEffect(() => {
    console.error("[airiq] page error", digest || error);
  }, [error, digest]);

  return (
    <section role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted">
        This page hit an unexpected problem. It may be a temporary issue with a data source. Trying again usually fixes it.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-contrast hover:opacity-90"
        >
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
          Go to the dashboard
        </Link>
      </div>
      {digest ? <p className="font-mono text-xs text-muted">Reference: {digest}</p> : null}
    </section>
  );
}
