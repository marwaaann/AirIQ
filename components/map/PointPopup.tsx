"use client";

import Link from "next/link";
import useSWR from "swr";

import { CategoryBadge } from "@/components/CategoryBadge";
import { beyondIndexLabel, formatIndex, getCategory, getUsCategory, isBeyondIndex, POLLUTANT_INFO, POLLUTANT_ORDER, SCALE_NAME } from "@/lib/aqi-categories";
import { apiFetch } from "@/lib/fetcher";
import { formatConcentration, formatPlaceTime, timeAgo } from "@/lib/format";
import { cellDominant, cellIndex } from "@/lib/map-layers";
import { formatCoords, makeCitySlug, MAP_POINT_SLUG_NAME } from "@/lib/slug";
import type { AqiScale, GridCell, Station } from "@/types/air";
import type { StationDetailResponse } from "@/types/api";

const SOURCE_LABEL = { waqi: "WAQI (aqicn.org)", openaq: "OpenAQ" } as const;

export function GridPopup({ cell, scale }: { cell: GridCell; scale: AqiScale }) {
  const aqi = cellIndex(cell, scale);
  const category = aqi === null ? null : getCategory(aqi, scale);
  const dominant = cellDominant(cell, scale);
  const slug = makeCitySlug(MAP_POINT_SLUG_NAME, cell.latitude, cell.longitude);
  return (
    <div className="flex w-60 flex-col gap-2 text-sm">
      <div>
        <p className="font-semibold">{formatCoords(cell.latitude, cell.longitude)}</p>
        <p className="text-xs text-muted">Open-Meteo (CAMS) model grid point</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xl font-bold">{formatIndex(aqi, scale)}</span>
        <span className="text-xs text-muted">{SCALE_NAME[scale]}</span>
        {category ? <CategoryBadge category={category} size="sm" /> : null}
      </div>
      {aqi !== null && isBeyondIndex(aqi, scale) ? <p className="text-xs font-bold">{beyondIndexLabel(aqi, scale)}</p> : null}
      {scale === "in" ? (
        <p className="text-xs text-muted">{aqi === null ? "Not enough data for NAQI. " : ""}NAQI computed by AirIQ from the model&rsquo;s last 24 h of concentrations.</p>
      ) : null}
      <p className="text-xs">
        Main pollutant: <strong>{dominant ? POLLUTANT_INFO[dominant].short : "n/a"}</strong>
      </p>
      <table className="w-full text-xs">
        <caption className="sr-only">Pollutant concentrations</caption>
        <tbody>
          {POLLUTANT_ORDER.map((p) => (
            <tr key={p} className="border-t border-border">
              <th scope="row" className="py-0.5 text-left font-medium">
                {POLLUTANT_INFO[p].short}
              </th>
              <td className="py-0.5 text-right font-mono tabular-nums">
                {formatConcentration(cell.pollutants[p])} {cell.pollutants[p] !== null ? "µg/m³" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">
        Updated <time dateTime={cell.time}>{timeAgo(cell.time)}</time>
      </p>
      <Link prefetch={false} href={`/city/${slug}`} className="font-semibold text-brand underline underline-offset-4">
        Open full dashboard →
      </Link>
    </div>
  );
}

/** Dominant pollutant and observation time from the station's own feed (WAQI only, loaded when the popup opens). */
function StationDetail({ station }: { station: Station }) {
  const { data, error } = useSWR<StationDetailResponse, Error>(station.source === "waqi" ? `/api/station?id=${station.id}` : null, apiFetch, {
    revalidateOnFocus: false,
  });
  if (station.source !== "waqi") {
    return (
      <p className="text-xs">
        Main pollutant: <strong>{station.dominant ? POLLUTANT_INFO[station.dominant].short : "not reported by this feed"}</strong>
      </p>
    );
  }
  return (
    <p className="text-xs" data-testid="station-dominant">
      Main pollutant:{" "}
      <strong>{data ? (data.dominant ? POLLUTANT_INFO[data.dominant].short : "not reported by this station") : error ? "unavailable" : "loading…"}</strong>
    </p>
  );
}

export function StationPopup({
  station,
  model,
  timeZone,
  fresh,
}: {
  station: Station;
  model: { value: number; distanceKm: number } | null;
  timeZone: string;
  /** Observed within the last 3 hours (computed by the parent). */
  fresh: boolean;
}) {
  const category = getUsCategory(station.aqi);
  const slug = makeCitySlug(station.name, station.latitude, station.longitude);
  return (
    <div className="flex w-64 flex-col gap-2 text-sm">
      <div>
        <p className="font-semibold">{station.name}</p>
        <p className="text-xs text-muted">
          Ground station · Source: <strong>{SOURCE_LABEL[station.source]}</strong>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xl font-bold">{formatIndex(station.aqi, "us")}</span>
        <span className="text-xs text-muted">US AQI</span>
        <CategoryBadge category={category} size="sm" />
      </div>
      {isBeyondIndex(station.aqi, "us") ? <p className="text-xs font-bold">{beyondIndexLabel(station.aqi, "us")}</p> : null}
      <p className="text-xs text-muted">
        {station.aqiBasis === "reported"
          ? "AQI as reported by the station network."
          : "AQI computed from the latest hourly PM2.5 reading (instantaneous, not a 24-hour average)."}
      </p>
      <StationDetail station={station} />
      {station.pm25 !== null ? (
        <p className="text-xs">
          PM2.5 (measured): <span className="font-mono">{formatConcentration(station.pm25)} µg/m³</span>
        </p>
      ) : (
        <p className="text-xs text-muted">This feed gives index values, not concentrations.</p>
      )}
      {station.updatedAt ? (
        <p className={`text-xs ${fresh ? "text-muted" : "font-medium text-danger"}`}>
          Observed {formatPlaceTime(station.updatedAt, timeZone)} (<time dateTime={station.updatedAt}>{timeAgo(station.updatedAt)}</time>)
          {fresh ? "" : " · older than 3 h, not used for headlines"}
        </p>
      ) : (
        <p className="text-xs text-muted">Observation time not given.</p>
      )}
      {model ? (
        <p className="text-xs" data-testid="popup-model-value">
          Model at this point: <strong>US AQI {formatIndex(model.value, "us")}</strong> (nearest grid point, {model.distanceKm < 1 ? "<1" : Math.round(model.distanceKm)} km)
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <Link prefetch={false} href={`/city/${slug}`} className="font-semibold text-brand underline underline-offset-4">
          Open full dashboard →
        </Link>
        {station.url ? (
          <a href={station.url} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-2">
            View on {SOURCE_LABEL[station.source]}
          </a>
        ) : null}
      </div>
    </div>
  );
}
