"use client";

import { useEffect, useRef, useState } from "react";

type Status = { kind: "idle" } | { kind: "shared" } | { kind: "copied" } | { kind: "manual"; url: string } | { kind: "error" };

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (e.g. insecure context or denied permission).
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Web Share API where available, otherwise copy the link. Always shows a
 * visible confirmation; if copying is impossible the link is shown to copy by hand.
 */
export function ShareButton({ getUrl, title, text, className = "" }: { getUrl: () => string; title: string; text: string; className?: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(s: Status) {
    setStatus(s);
    if (timer.current) clearTimeout(timer.current);
    if (s.kind === "shared" || s.kind === "copied") timer.current = setTimeout(() => setStatus({ kind: "idle" }), 4000);
  }

  async function onClick() {
    const url = getUrl();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        flash({ kind: "shared" });
        return;
      } catch (err) {
        // The user closed the share sheet: no message needed.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Otherwise (NotAllowedError, unsupported data) fall back to copying.
      }
    }
    flash((await copyText(url)) ? { kind: "copied" } : { kind: "manual", url });
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => void onClick()}
        data-testid="share-button"
        className={`inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2 ${className}`}
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Share
      </button>
      <p role="status" aria-live="polite" className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-text px-2 py-0.5 text-xs text-bg empty:hidden" data-testid="share-status">
        {status.kind === "copied" ? "Link copied to clipboard." : status.kind === "shared" ? "Shared." : null}
      </p>
      {status.kind === "manual" ? (
        <label className="absolute right-0 top-full z-20 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-border bg-surface p-2 text-xs shadow-lg">
          Couldn&rsquo;t copy automatically. Copy this link:
          <input readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} className="rounded border border-border bg-surface px-2 py-1 font-mono" />
        </label>
      ) : null}
    </div>
  );
}
