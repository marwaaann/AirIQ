"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "@/lib/zod";

import { fallbackPlaceName } from "@/lib/place";
import type { LabelKind } from "@/lib/slug";

export type GeoStatus = "idle" | "locating" | "success" | "denied" | "unavailable" | "timeout" | "unsupported";

export interface GeoState {
  status: GeoStatus;
  coords: { latitude: number; longitude: number } | null;
  message: string | null;
}

const MESSAGES: Record<Exclude<GeoStatus, "idle" | "locating" | "success">, string> = {
  denied: "Location permission was denied. Allow location access in your browser settings, or search for a city.",
  unavailable: "Your location could not be determined right now. Try again, or search for a city.",
  timeout: "Finding your location took too long. Try again, or search for a city.",
  unsupported: "This browser does not support geolocation. Search for a city instead.",
};

/** Browser geolocation with explicit denied / unavailable / timeout handling. */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle", coords: null, message: null });

  const locate = useCallback((): Promise<{ latitude: number; longitude: number } | null> => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "unsupported", coords: null, message: MESSAGES.unsupported });
      return Promise.resolve(null);
    }
    setState({ status: "locating", coords: null, message: null });
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setState({ status: "success", coords, message: null });
          resolve(coords);
        },
        (err) => {
          const status: GeoStatus =
            err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
          setState({ status, coords: null, message: MESSAGES[status] });
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
      );
    });
  }, []);

  return { ...state, locate };
}

/* ------------------------------------------------------------------------- */
/* Reverse label (BigDataCloud free client endpoint, no key)                  */
/* ------------------------------------------------------------------------- */

const BdcSchema = z.object({
  city: z.string().optional().default(""),
  locality: z.string().optional().default(""),
  principalSubdivision: z.string().optional().default(""),
  countryName: z.string().optional().default(""),
});

export interface PlaceLabel {
  name: string;
  subtitle?: string;
}

export function fallbackLocationLabel(latitude: number, longitude: number, kind: LabelKind = "my-location"): PlaceLabel {
  return { name: fallbackPlaceName(kind, latitude, longitude) };
}

/** Reverse-geocode coordinates to a place name. Returns null on any failure. */
export async function reverseLabel(latitude: number, longitude: number, signal?: AbortSignal): Promise<PlaceLabel | null> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?${new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    localityLanguage: "en",
  })}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const parsed = BdcSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const d = parsed.data;
    const name = d.city || d.locality;
    if (!name) return null;
    const subtitle = [d.principalSubdivision, d.countryName].filter((s) => s && s !== name).join(", ");
    return { name, subtitle: subtitle || undefined };
  } catch {
    return null;
  }
}

/**
 * Resolve a label for coordinates in the background. Starts with the
 * coordinate fallback so the UI never waits on the network.
 *
 * Only for "Use my location": BigDataCloud's free client endpoint may be used
 * only with the device's own current location (its terms, checked 2026-11-11).
 * Map points keep their "Map point (lat, lon)" label.
 */
export function useReverseLabel(latitude: number, longitude: number, kind: LabelKind | null) {
  const enabled = kind === "my-location";
  const [label, setLabel] = useState<PlaceLabel>(() => fallbackLocationLabel(latitude, longitude, kind ?? "my-location"));
  const [resolved, setResolved] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    reverseLabel(latitude, longitude, ctrl.signal).then((l) => {
      done.current = true;
      if (l) {
        setLabel(l);
        setResolved(true);
      }
    });
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [latitude, longitude, enabled]);

  return { label, resolved };
}
