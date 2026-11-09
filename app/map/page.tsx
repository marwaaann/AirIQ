import type { Metadata } from "next";

import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Pollution map" };

export default function Page() {
  return <ComingSoon title="Pollution map" phase={3} description="An interactive map with AQI-colored markers, a pollutant layer switcher, and a heatmap built from a live grid of Open-Meteo points." />;
}
