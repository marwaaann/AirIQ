"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { z } from "zod";

/**
 * Typed, validated localStorage values shared across components.
 *
 * - Every read and write is wrapped in try/catch (private mode, quota, blocked
 *   storage). On failure the in-memory value still works for the session.
 * - Values are validated with Zod on read, so corrupted entries fall back to
 *   the default instead of crashing.
 * - Built on useSyncExternalStore: the server snapshot is the default, so
 *   hydration never mismatches, and other tabs stay in sync via `storage`.
 */

const LOCAL_EVENT = "airiq:storage";

export interface StoredValue<T> {
  key: string;
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(cb: () => void): () => void;
  fallback: T;
}

export type StorageArea = "local" | "session";

export function createStoredValue<T>(key: string, schema: z.ZodType<T>, fallback: T, area: StorageArea = "local"): StoredValue<T> {
  const storage = (): Storage => (area === "session" ? window.sessionStorage : window.localStorage);
  let cacheRaw: string | null | undefined;
  let cacheValue: T = fallback;
  /** Used when localStorage is unavailable, so state still works in-session. */
  let memory: T | undefined;

  const read = (): T => {
    let raw: string | null;
    try {
      raw = storage().getItem(key);
    } catch {
      return memory ?? fallback;
    }
    if (raw === cacheRaw) return cacheValue;
    cacheRaw = raw;
    if (raw === null) {
      cacheValue = memory ?? fallback;
      return cacheValue;
    }
    let valid = false;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        cacheValue = parsed.data;
        valid = true;
        // Lenient schemas drop malformed items: persist the cleaned value so
        // the bad entries are discarded from storage, not just ignored.
        const cleaned = JSON.stringify(parsed.data);
        if (cleaned !== JSON.stringify(JSON.parse(raw))) {
          try {
            storage().setItem(key, cleaned);
            cacheRaw = cleaned;
          } catch {
            // Storage full or blocked: the cleaned value still lives in memory.
          }
        }
      }
    } catch {
      // Not JSON at all.
    }
    if (!valid) {
      // Corrupted or from an incompatible version: discard it so it can't break later reads.
      cacheValue = memory ?? fallback;
      try {
        storage().removeItem(key);
        cacheRaw = null;
      } catch {
        // Storage blocked: keep using the fallback in memory.
      }
    }
    return cacheValue;
  };

  return {
    key,
    fallback,
    get: () => (typeof window === "undefined" ? fallback : read()),
    set(next) {
      const prev = read();
      const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      memory = value;
      try {
        storage().setItem(key, JSON.stringify(value));
      } catch {
        // Storage blocked or full: keep the in-memory value.
        cacheRaw = undefined;
      }
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }));
    },
    subscribe(cb) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) cb();
      };
      const onLocal = (e: Event) => {
        if (e instanceof CustomEvent && e.detail === key) cb();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(LOCAL_EVENT, onLocal);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(LOCAL_EVENT, onLocal);
      };
    },
  };
}

/** React binding for a StoredValue. Returns the default during SSR/hydration. */
export function useStoredValue<T>(store: StoredValue<T>): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(store.subscribe, store.get, () => store.fallback);
  const set = useCallback((next: T | ((prev: T) => T)) => store.set(next), [store]);
  return [value, set];
}

/** True after hydration; lets components avoid flashing defaults as "real" state. */
const noopSubscribe = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
