/**
 * Which way to show an alert notification. Pure module.
 *
 * 1. ServiceWorkerRegistration.showNotification: works where page-created
 *    notifications are refused (e.g. Chrome on Android), and the worker's
 *    notificationclick handler opens the city.
 * 2. `new Notification()` from the page (desktop browsers without a worker).
 * 3. In-app only (toast + bell): no permission, or neither API available.
 */
export type NotifyPath = "service-worker" | "page" | "in-app";

export function chooseNotifyPath(o: { permission: "unsupported" | "default" | "granted" | "denied"; hasActiveWorker: boolean; hasConstructor: boolean }): NotifyPath {
  if (o.permission !== "granted") return "in-app";
  if (o.hasActiveWorker) return "service-worker";
  if (o.hasConstructor) return "page";
  return "in-app";
}

/** Next path to try after `failed` threw. */
export function fallbackAfter(failed: NotifyPath, hasConstructor: boolean): NotifyPath {
  if (failed === "service-worker" && hasConstructor) return "page";
  return "in-app";
}
