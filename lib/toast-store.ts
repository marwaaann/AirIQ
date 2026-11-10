"use client";

import { useSyncExternalStore } from "react";

/** In-memory toast queue (not persisted). */
export interface Toast {
  id: string;
  title: string;
  body: string;
  href?: string;
  tone: "alert" | "info";
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushToast(t: Omit<Toast, "id"> & { id?: string }): void {
  const id = t.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (toasts.some((x) => x.id === id)) return;
  toasts = [...toasts, { ...t, id }].slice(-4);
  emit();
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => EMPTY,
  );
}
