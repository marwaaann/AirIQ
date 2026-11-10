import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CityReport } from "@/components/report/CityReport";
import { Skeleton } from "@/components/states";
import { ViewOverrideProvider } from "@/hooks/useViewOverride";
import { cityMetadata } from "@/lib/city-metadata";
import { resolvePlace } from "@/lib/resolve-place";
import { parseCitySlug } from "@/lib/slug";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseCitySlug(slug);
  if (!parsed) return { title: "Place not found" };
  const place = await resolvePlace(slug, parsed);
  return cityMetadata(place, "report");
}

export default async function ReportPage({ params }: Props) {
  const { slug } = await params;
  const parsed = parseCitySlug(slug);
  if (!parsed) notFound();
  const place = await resolvePlace(slug, parsed);
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" label="Loading report" />}>
      <ViewOverrideProvider>
        <CityReport place={{ slug: place.slug, name: place.name, subtitle: place.subtitle, latitude: place.latitude, longitude: place.longitude }} />
      </ViewOverrideProvider>
    </Suspense>
  );
}
