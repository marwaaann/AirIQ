"use client";

/**
 * Stand-in for a lazily loaded view whose code could not be downloaded
 * (offline, and never opened while online). Used as the fallback of
 * `import(...).catch(...)` so the rest of the page keeps working.
 */
export function OfflineUnavailable({ what = "This view" }: { what?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 p-4 text-sm" data-testid="view-offline">
      <p className="font-semibold">{what} isn&rsquo;t available offline yet</p>
      <p className="text-muted">It hasn&rsquo;t been opened while online, so its code isn&rsquo;t saved on this device. Connect and reload to use it.</p>
      <button type="button" onClick={() => location.reload()} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
        Reload
      </button>
    </div>
  );
}

/**
 * Fallback for `import("…").catch(offlineFallback("History"))`: the lazy view
 * resolves to an offline notice instead of throwing ChunkLoadError.
 */
export function offlineFallback(what: string) {
  return function fallbackModule(): { default: () => React.JSX.Element } {
    return {
      default: function Unavailable() {
        return <OfflineUnavailable what={what} />;
      },
    };
  };
}
