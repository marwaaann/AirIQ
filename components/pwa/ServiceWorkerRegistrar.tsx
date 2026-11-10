"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const BUILD = process.env.AIRIQ_BUILD_VERSION ?? "dev";

function postToWorker(msg: unknown) {
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(msg)).catch(() => undefined);
}

/** Same-origin static files this page has loaded (for the worker to keep for offline use). */
function loadedAssets(): string[] {
  try {
    return performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
  } catch {
    return [];
  }
}

/**
 * Registers /sw.js in production builds only (a worker caching dev-server
 * assets would fight hot reload). After each route change it asks the worker
 * to keep this page and its assets for offline use. It also handles the
 * worker's NAVIGATE message from a notification click.
 */
export function ServiceWorkerRegistrar() {
  const pathname = usePathname();
  const enabled = process.env.NODE_ENV === "production";

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD)}`, { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    const onMessage = (e: MessageEvent) => {
      const d: unknown = e.data;
      if (typeof d !== "object" || d === null || (d as { type?: unknown }).type !== "NAVIGATE") return;
      const url = (d as { url?: unknown }).url;
      if (typeof url !== "string") return;
      try {
        const u = new URL(url, location.origin);
        if (u.origin === location.origin) location.assign(u.href);
      } catch {
        // ignore malformed
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator) || !navigator.onLine) return;
    // Give lazy chunks of the new route a moment to load first.
    const t = setTimeout(() => {
      postToWorker({ type: "CACHE_URLS", urls: loadedAssets() });
      postToWorker({ type: "CACHE_PAGE", url: location.href });
    }, 2500);
    return () => clearTimeout(t);
  }, [enabled, pathname]);

  return null;
}
