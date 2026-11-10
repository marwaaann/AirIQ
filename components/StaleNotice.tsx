"use client";

import { RefreshIcon } from "@/components/icons";
import { useNow } from "@/hooks/useNow";
import { useOnline } from "@/hooks/useOnline";
import { staleBannerText, type StaleMeta } from "@/lib/stale";

/**
 * Visible label for data served from the offline cache:
 * "Offline: showing data from 14:20, not live" in the given time zone (the
 * city's), with Retry. Renders nothing for live data, so stale data is never
 * shown unlabelled wherever a panel includes it.
 */
export function StaleNotice({
  meta,
  timeZone,
  onRetry,
  retrying = false,
  compact = false,
  className = "",
}: {
  meta: StaleMeta;
  timeZone: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const now = useNow(60_000);
  const online = useOnline();
  if (!meta.isStale) return null;
  const text = staleBannerText(meta.cachedAt, timeZone, now, !online);
  return (
    <div
      role="status"
      data-testid="stale-notice"
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 ${compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"} ${className}`}
    >
      <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span className="flex-1 font-medium">{text}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-70"
        >
          <RefreshIcon size={12} className={retrying ? "animate-spin" : ""} /> {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}
