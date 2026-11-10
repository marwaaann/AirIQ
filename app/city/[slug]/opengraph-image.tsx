import { ImageResponse } from "next/og";

import { liveSnapshot } from "@/lib/city-metadata";
import { resolvePlace } from "@/lib/resolve-place";
import { parseCitySlug } from "@/lib/slug";

export const alt = "AirIQ live air quality preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0e14";
const FG = "#e6ebf2";
const MUTED = "#98a4b5";
const BRAND = "#2dd4bf";

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: BRAND, display: "flex", alignItems: "center", justifyContent: "center", color: BG, fontSize: 26, fontWeight: 700 }}>
        A
      </div>
      <div style={{ fontSize: 34, fontWeight: 700, color: FG }}>AirIQ</div>
    </div>
  );
}

/**
 * Social preview for a city page (and its report). With live data: city name,
 * current US AQI, category and its color. If live data fails or the place is
 * unnamed: a neutral card with the name only, never a guessed or stale value.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parseCitySlug(slug);
  const place = parsed ? await resolvePlace(slug, parsed).catch(() => null) : null;
  const name = place?.name ?? "Air quality";
  const live = place && !place.labelKind ? await liveSnapshot(place.latitude, place.longitude) : null;
  const nameSize = name.length > 22 ? 64 : name.length > 14 ? 84 : 104;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, padding: 64, fontFamily: "sans-serif" }}>
        <Brand />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: live ? 640 : 1072 }}>
            {place ? <div style={{ fontSize: 28, color: MUTED }}>{live ? "Air quality right now" : "Air quality"}</div> : null}
            <div style={{ fontSize: nameSize, fontWeight: 700, color: FG, lineHeight: 1.05 }}>{name}</div>
            {place?.subtitle ? <div style={{ fontSize: 30, color: MUTED }}>{place.subtitle}</div> : null}
          </div>
          {live ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: 360,
                height: 300,
                borderRadius: 32,
                background: live.color,
                color: live.textColor,
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 600 }}>US AQI</div>
              <div style={{ fontSize: 140, fontWeight: 800, lineHeight: 1 }}>{String(live.usAqi)}</div>
              <div style={{ fontSize: 32, fontWeight: 700, textAlign: "center", padding: "0 16px" }}>{live.label}</div>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: MUTED }}>
          <div>{live ? "Live model data · Open-Meteo (CAMS)" : "Live AQI, forecast and health advice"}</div>
          <div style={{ color: BRAND }}>AirIQ</div>
        </div>
      </div>
    ),
    { ...size, headers: { "Cache-Control": "public, max-age=600, s-maxage=600" } },
  );
}
