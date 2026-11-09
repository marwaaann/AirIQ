"use client";

import Link from "next/link";

import { CategoryBadge } from "@/components/CategoryBadge";
import { getCategory, getUsCategory, POLLUTANT_INFO, POLLUTANT_ORDER } from "@/lib/aqi-categories";
import { formatConcentration, timeAgo } from "@/lib/format";
import { cellDominant } from "@/lib/map-layers";
import { formatCoords, makeCitySlug, MAP_POINT_SLUG_NAME } from "@/lib/slug";
import type { AqiScale, GridCell, Station } from "@/types/air";

const SOURCE_LABEL = { waqi: "WAQI (aqicn.org)", openaq: "OpenAQ" } as const;

export function GridPopup({ cell, scale }: { cell: GridCell; scale: AqiScale }) {
  const aqi = scale === "us" ? cell.usAqi : cell.euAqi;
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
        <span className="font-mono text-2xl font-bold">{aqi !== null ? Math.round(aqi) : "n/a"}</span>
        <span className="text-xs text-muted">{scale === "us" ? "US AQI" : "European AQI"}</span>
        {category ? <CategoryBadge category={category} size="sm" /> : null}
      </div>
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
      <Link href={`/city/${slug}`} className="font-semibold text-brand underline underline-offset-4">
        Open full dashboard →
      </Link>
    </div>
  );
}

export function StationPopup({ station }: { station: Station }) {
  const category = getUsCategory(station.aqi);
  const slug = makeCitySlug(station.name, station.latitude, station.longitude);
  return (
    <div className="flex w-60 flex-col gap-2 text-sm">
      <div>
        <p className="font-semibold">{station.name}</p>
        <p className="text-xs text-muted">
          Ground station · Source: <strong>{SOURCE_LABEL[station.source]}</strong>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xl font-bold">{station.aqi}</span>
        <span className="text-xs text-muted">US AQI</span>
        <CategoryBadge category={category} size="sm" />
      </div>
      <p className="text-xs text-muted">
        {station.aqiBasis === "reported"
          ? "AQI as reported by the station network."
          : "AQI computed from the latest hourly PM2.5 reading (instantaneous, not a 24-hour average)."}
      </p>
      <p className="text-xs">
        Main pollutant: <strong>{station.dominant ? POLLUTANT_INFO[station.dominant].short : "not reported by this feed"}</strong>
      </p>
      {station.pm25 !== null ? (
        <p className="text-xs">
          PM2.5: <span className="font-mono">{formatConcentration(station.pm25)} µg/m³</span>
        </p>
      ) : (
        <p className="text-xs text-muted">Per-pollutant values are not included in this feed. Open the dashboard for model data.</p>
      )}
      {station.updatedAt ? (
        <p className="text-xs text-muted">
          Updated <time dateTime={station.updatedAt}>{timeAgo(station.updatedAt)}</time>
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <Link href={`/city/${slug}`} className="font-semibold text-brand underline underline-offset-4">
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
