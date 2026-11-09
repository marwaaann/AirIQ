import type { Metadata } from "next";

import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Smart alerts" };

export default function Page() {
  return <ComingSoon title="Smart alerts" phase={5} description="Set AQI and pollutant thresholds for your cities and health profile. Get browser notifications for current readings and the forecast." />;
}
