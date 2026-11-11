"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { useNow } from "@/hooks/useNow";
import { eventsStore } from "@/lib/alert-store";
import { timeAgo } from "@/lib/format";
import { useHydrated, useStoredValue } from "@/lib/storage";

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** Header bell: unread count + the latest events. */
export function AlertBell() {
  const [events, setEvents] = useStoredValue(eventsStore);
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(60_000);
  const unread = hydrated ? events.filter((e) => !e.read).length : 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={unread ? `Alerts: ${unread} unread` : "Alerts"}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text hover:bg-surface-2"
      >
        <BellIcon />
        {unread ? (
          <span
            data-testid="unread-count"
            className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-danger-contrast"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label="Recent alerts"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-2 shadow-xl"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-sm font-semibold">Recent alerts</p>
            {unread ? (
              <button
                type="button"
                className="text-xs font-medium text-brand underline underline-offset-2"
                onClick={() => setEvents((prev) => prev.map((e) => ({ ...e, read: true })))}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {events.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No alerts yet. Create one on the Alerts page.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {events.slice(0, 6).map((e) => (
                <li key={e.id} className="rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                  <Link prefetch={false} href={`/city/${e.citySlug}`} onClick={() => setOpen(false)} className="block">
                    <span className="flex items-start gap-2">
                      {!e.read ? <span aria-label="unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" /> : <span className="mt-1.5 h-2 w-2 shrink-0" />}
                      <span className="min-w-0">
                        <span className="block font-medium">{e.title}</span>
                        <span className="block text-xs text-muted">
                          {timeAgo(e.createdAt, now)}
                          {e.suppressed ? " · suppressed (quiet hours)" : ""}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/alerts" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-2 py-2 text-center text-sm font-semibold text-brand hover:bg-surface-2">
            View all alerts
          </Link>
        </div>
      ) : null}
    </div>
  );
}
