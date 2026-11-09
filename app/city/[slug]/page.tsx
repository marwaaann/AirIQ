import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CityDashboard } from "@/components/CityDashboard";
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
  return {
    title: `Air quality in ${place.name}`,
    description: `Live AQI, pollutant levels and WHO comparison for ${place.name}${place.subtitle ? `, ${place.subtitle}` : ""}.`,
  };
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  const parsed = parseCitySlug(slug);
  if (!parsed) notFound();
  const place = await resolvePlace(slug, parsed);
  return <CityDashboard place={place} />;
}
