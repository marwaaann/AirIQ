"use client";

import { useCallback, useSyncExternalStore } from "react";

import { chooseNotifyPath, fallbackAfter, type NotifyPath } from "@/lib/notify-path";

export type NotificationStatus = "unsupported" | "default" | "granted" | "denied";

const CHANGED = "airiq:notification-permission";

function read(): NotificationStatus {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function subscribe(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    document.removeEventListener("visibilitychange", cb);
    window.removeEventListener(CHANGED, cb);
  };
}

/**
 * Browser notification permission. `request` must only be called from a user
 * gesture (a button click); nothing here asks on page load.
 */
export function useNotificationPermission(): { status: NotificationStatus; request: () => Promise<NotificationStatus> } {
  const status = useSyncExternalStore(subscribe, read, () => "default" as NotificationStatus);
  const request = useCallback(async () => {
    if (read() !== "unsupported") {
      try {
        await Notification.requestPermission();
      } catch {
        // Older Safari: callback form only. Status is re-read below either way.
      }
    }
    window.dispatchEvent(new Event(CHANGED));
    return read();
  }, []);
  return { status, request };
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ? reg : null;
  } catch {
    return null;
  }
}

/**
 * Show an alert as a system notification if permission was granted.
 * Prefers ServiceWorkerRegistration.showNotification (the worker's
 * notificationclick opens `href`), then `new Notification()` from the page,
 * then nothing (the caller always shows the in-app toast anyway).
 * Returns the path that was used.
 */
export async function showBrowserNotification(title: string, body: string, tag: string, href: string, onClick: () => void): Promise<NotifyPath> {
  const hasConstructor = typeof window !== "undefined" && "Notification" in window;
  const reg = await activeRegistration();
  let path = chooseNotifyPath({ permission: read(), hasActiveWorker: reg !== null, hasConstructor });
  if (path === "service-worker" && reg) {
    try {
      await reg.showNotification(title, { body, tag, data: { url: href }, icon: "/pwa-icon/192", badge: "/pwa-icon/192" });
      return path;
    } catch {
      path = fallbackAfter(path, hasConstructor);
    }
  }
  if (path === "page") {
    try {
      const n = new Notification(title, { body, tag });
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
      return path;
    } catch {
      // Browsers that only allow notifications from a service worker.
    }
  }
  return "in-app";
}
