"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import { REVALIDATE_EVENT, useOnline } from "@/hooks/useOnline";

/**
 * A persistent "You're offline" pill while offline, and a "Back online" toast
 * when the connection returns, which revalidates every SWR key (all visible
 * panels refetch) and tells non-SWR views (the map) to reload.
 */
export function ConnectivityStatus() {
  const online = useOnline();
  const { mutate } = useSWRConfig();
  const [backOnline, setBackOnline] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    void mutate(() => true);
    window.dispatchEvent(new Event(REVALIDATE_EVENT));
    const show = setTimeout(() => setBackOnline(true), 0);
    const hide = setTimeout(() => setBackOnline(false), 5000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [online, mutate]);

  if (online && !backOnline) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[2100] flex justify-center px-4 sm:bottom-4">
      <p
        role="status"
        aria-live="polite"
        data-testid={online ? "back-online-toast" : "offline-pill"}
        className={`pointer-events-auto rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${online ? "bg-brand text-brand-contrast" : "bg-text text-bg"}`}
      >
        {online ? "Back online. Refreshing data…" : "You’re offline. Saved data is labelled with its time."}
      </p>
    </div>
  );
}
