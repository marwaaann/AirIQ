"use client";

import { useCallback, useSyncExternalStore } from "react";

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

/** Show a browser notification if allowed. Returns whether one was shown. */
export function showBrowserNotification(title: string, body: string, tag: string, onClick: () => void): boolean {
  if (read() !== "granted") return false;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
    return true;
  } catch {
    // Some browsers only allow notifications from a service worker.
    return false;
  }
}
