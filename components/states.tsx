import type { ReactNode } from "react";

import { AlertIcon, RefreshIcon } from "@/components/icons";

/** Shimmering placeholder block. */
export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return (
    <div className={`skeleton ${className}`} role={label ? "status" : undefined} aria-label={label} aria-busy={label ? true : undefined}>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}

/** Error with an optional Retry button. Never shows stale or invented numbers. */
export function ErrorState({
  title = "Couldn't load data",
  message,
  onRetry,
  retrying = false,
  compact = false,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  /** A retry is in flight (manual or automatic). */
  retrying?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex ${compact ? "flex-col items-start gap-2 p-3" : "flex-col items-center gap-3 p-8 text-center"} rounded-xl border border-danger/40 bg-danger/5`}
    >
      <div className="flex items-center gap-2 font-semibold text-danger">
        <AlertIcon size={compact ? 16 : 20} />
        <span className={compact ? "text-sm" : ""}>{title}</span>
      </div>
      {message ? <p className={`${compact ? "text-xs" : "text-sm"} max-w-prose break-words text-muted`}>{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-70"
        >
          <RefreshIcon size={14} className={retrying ? "animate-spin" : ""} /> {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="font-semibold">{title}</p>
      {children ? <div className="max-w-prose text-sm text-muted">{children}</div> : null}
    </div>
  );
}
