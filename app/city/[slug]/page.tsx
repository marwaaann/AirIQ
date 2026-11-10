import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CityDashboard } from "@/components/CityDashboard";
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
  return cityMetadata(place, "city");
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  const parsed = parseCitySlug(slug);
  if (!parsed) notFound();
  const place = await resolvePlace(slug, parsed);
  return (
    <ViewOverrideProvider>
      <CityDashboard place={place} />
    </ViewOverrideProvider>
  );
}
