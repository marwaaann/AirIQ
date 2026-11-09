"use client";

import { useRouter } from "next/navigation";

import { LocationIcon } from "@/components/icons";
import { useGeolocation } from "@/hooks/useGeolocation";
import { makeCitySlug, MY_LOCATION_SLUG_NAME } from "@/lib/slug";

/**
 * "Use my location". Navigates as soon as coordinates are known; the city page
 * resolves a human-readable label in the background (never blocking the data).
 */
export function LocateButton({ variant = "hero" }: { variant?: "hero" | "compact" }) {
  const router = useRouter();
  const geo = useGeolocation();
  const locating = geo.status === "locating";

  async function onClick() {
    const coords = await geo.locate();
    if (coords) router.push(`/city/${makeCitySlug(MY_LOCATION_SLUG_NAME, coords.latitude, coords.longitude)}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={locating}
        aria-busy={locating}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface font-medium hover:bg-surface-2 disabled:opacity-70 ${variant === "hero" ? "h-14 px-5 text-base" : "h-10 px-3 text-sm"}`}
      >
        <LocationIcon size={variant === "hero" ? 20 : 16} className={locating ? "animate-pulse" : ""} />
        {locating ? "Locating…" : "Use my location"}
      </button>
      {geo.message ? (
        <p role="alert" className="max-w-sm text-sm text-danger">
          {geo.message}
        </p>
      ) : null}
    </div>
  );
}
