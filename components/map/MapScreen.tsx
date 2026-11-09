"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/states";

/** Everything Leaflet-related is client-only. */
const MapClient = dynamic(() => import("@/components/map/MapClient"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" label="Loading map" />,
});

/** Full-bleed map sized to the viewport below the sticky site header. */
export function MapScreen() {
  const [headerH, setHeaderH] = useState(101);

  useEffect(() => {
    const header = document.querySelector("body > header");
    if (!(header instanceof HTMLElement)) return;
    const ro = new ResizeObserver(() => setHeaderH(header.offsetHeight));
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-fullbleed className="relative w-full" style={{ height: `calc(100dvh - ${headerH}px)` }}>
      <h1 className="sr-only">Air quality map</h1>
      <MapClient />
    </div>
  );
}
