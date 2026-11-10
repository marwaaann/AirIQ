import type { Metadata } from "next";
import { Suspense } from "react";

import { AlertsPage } from "@/components/alerts/AlertsPage";
import { Skeleton } from "@/components/states";

export const metadata: Metadata = {
  title: "Smart alerts",
  description: "Air-quality alerts for your cities, based on current readings and the official forecast. They run while AirIQ is open.",
};

export default function Page() {
  return (
    // useSearchParams (prefilled "create alert" links) needs a Suspense boundary on a static page.
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" label="Loading alerts" />}>
      <AlertsPage />
    </Suspense>
  );
}
