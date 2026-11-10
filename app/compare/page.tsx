import type { Metadata } from "next";
import { Suspense } from "react";

import { CompareView } from "@/components/compare/CompareView";
import { Skeleton } from "@/components/states";

export const metadata: Metadata = {
  title: "Compare cities",
  description: "Compare live air quality, history and the official forecast for 2 to 4 cities side by side.",
};

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" label="Loading comparison" />}>
      <CompareView />
    </Suspense>
  );
}
