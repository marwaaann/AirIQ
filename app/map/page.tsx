import type { Metadata } from "next";

import { MapScreen } from "@/components/map/MapScreen";

export const metadata: Metadata = {
  title: "Pollution map",
  description: "Live air-quality map with AQI and pollutant layers, an interpolated heatmap, and optional ground stations.",
};

export default function MapPage() {
  return <MapScreen />;
}
