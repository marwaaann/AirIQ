"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CategorySwatch } from "@/components/CategoryBadge";
import { useNow } from "@/hooks/useNow";
import { formatIndex, getInCategory, getUsCategory } from "@/lib/aqi-categories";
import { formatInZone, timeAgo } from "@/lib/format";
import { haversineKm, HEADLINE_RADIUS_KM, isFresh, shortName, type HeadlineSource, type NearbyStation } from "@/lib/headline-source";
import { NAQI_SHORT } from "@/lib/naqi";
import { describeConcentration, matchStation, usableStations } from "@/lib/station-naqi";
import type { NearbyStationsResponse, StationNaqiResponse } from "@/types/api";

type SortKey = "aqi" | "name" | "distance" | "age";

const SOURCE_NAME = { waqi: "WAQI", openaq: "OpenAQ" } as const;

function ageMs(s: NearbyStation, now: number): number {
  return s.observedAt ? now - Date.parse(s.observedAt) : Number.POSITIVE_INFINITY;
}

/**
 * "Stations near you": every station within 15 km, sortable by AQI, name,
 * distance and age. Stations older than 3 hours are listed but marked as not
 * used for the headline.
 */
export function StationsPanel({
  near,
  error,
  naqi,
  headline,
  lat,
  lon,
  timeZone,
}: {
  near: NearbyStationsResponse | undefined;
  error: unknown;
  /** Station-based NAQI (NAQI scale only). */
  naqi?: StationNaqiResponse;
  headline: HeadlineSource | null;
  lat: number;
  lon: number;
  timeZone: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "distance", dir: 1 });
  const now = useNow(60_000);
  const stations = useMemo(() => {
    const list = [...(near?.stations ?? [])];
    const cmp: Record<SortKey, (a: NearbyStation, b: NearbyStation) => number> = {
      aqi: (a, b) => a.aqi - b.aqi,
      name: (a, b) => a.name.localeCompare(b.name),
      distance: (a, b) => a.distanceKm - b.distanceKm,
      age: (a, b) => ageMs(a, now) - ageMs(b, now),
    };
    return list.sort((a, b) => cmp[sort.key](a, b) * sort.dir);
  }, [near, sort, now]);

  const mapHref = `/map?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&z=11&layer=aqi`;
  const header = (key: SortKey, label: string, align = "text-left") => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`py-1.5 pr-2 font-semibold ${align}`}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "aqi" ? -1 : 1 }))}
          className="inline-flex items-center gap-1 rounded hover:underline"
        >
          {label}
          <span aria-hidden className="text-muted">
            {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section aria-labelledby="stations-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4" data-testid="stations-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="stations-title" className="text-base font-semibold">
          Stations near you
        </h2>
        <Link prefetch={false} href={mapHref} className="text-sm font-semibold text-brand underline underline-offset-4">
          Show on map →
        </Link>
      </div>
      <p className="text-xs text-muted">
        Ground stations within {HEADLINE_RADIUS_KM} km, US AQI as reported by the network ({near?.source === "openaq" ? "OpenAQ" : "WAQI"}). Stations
        older than 3 hours are listed but not used for the headline.
        {headline && headline.stationCount > 0 ? ` ${headline.stationCount} fresh station${headline.stationCount === 1 ? "" : "s"} in range.` : ""}
      </p>
      {error && !near ? (
        <p className="text-sm text-danger" role="status">
          No nearby station data: the station feed could not be reached.
        </p>
      ) : !near ? (
        <p className="text-sm text-muted" role="status">
          Loading stations…
        </p>
      ) : near.status === "not-configured" ? (
        <p className="text-sm text-muted">No nearby station data: ground stations are not configured on this server.</p>
      ) : near.status === "error" ? (
        <p className="text-sm text-danger">No nearby station data: {near.note ?? "the station feed is unavailable"}.</p>
      ) : stations.length === 0 ? (
        <p className="text-sm text-muted">No station within {HEADLINE_RADIUS_KM} km. The headline uses the model.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm" data-testid="stations-table">
            <caption className="sr-only">Ground stations within {HEADLINE_RADIUS_KM} km, sortable</caption>
            <thead className="sticky top-0 bg-surface text-xs">
              <tr className="border-b border-border">
                {header("aqi", "AQI")}
                {header("name", "Station")}
                {header("distance", "Distance", "text-right")}
                {header("age", "Observed", "text-right")}
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const cat = getUsCategory(s.aqi);
                const fresh = isFresh(s.observedAt, now);
                return (
                  <tr key={s.id} className={`border-b border-border/60 ${fresh ? "" : "text-muted"}`} data-fresh={fresh ? "true" : "false"}>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold tabular-nums">
                        <CategorySwatch category={cat} className="h-3 w-3" />
                        {formatIndex(s.aqi, "us")}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" title={`${s.name} · ${SOURCE_NAME[s.source]}`}>
                          {shortName(s.name)}
                        </a>
                      ) : (
                        shortName(s.name)
                      )}
                      {!fresh ? <span className="ml-1 text-xs">(not used: older than 3 h)</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{s.distanceKm < 1 ? "<1" : s.distanceKm.toFixed(1)} km</td>
                    <td className="py-1.5 text-right text-xs tabular-nums">
                      {s.observedAt ? (
                        <time dateTime={s.observedAt} title={timeAgo(s.observedAt, now)}>
                          {formatInZone(s.observedAt, timeZone, { hour: "2-digit", minute: "2-digit" })} · {timeAgo(s.observedAt, now)}
                        </time>
                      ) : (
                        "time not given"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {naqi ? <StationNaqiTable naqi={naqi} waqi={near?.source === "waqi" ? near.stations : []} timeZone={timeZone} now={now} /> : null}
    </section>
  );
}

/**
 * India NAQI per OpenAQ station (computed by AirIQ from its concentrations),
 * with the same site's WAQI US AQI beside it when one matches by
 * name/coordinates. The two numbers are shown side by side, never mixed.
 */
function StationNaqiTable({ naqi, waqi, timeZone, now }: { naqi: StationNaqiResponse; waqi: readonly NearbyStation[]; timeZone: string; now: number }) {
  const usable = new Set(usableStations(naqi.stations, now).map((s) => s.id));
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="station-naqi-panel">
      <h3 className="text-sm font-semibold">India NAQI by station</h3>
      <p className="text-xs text-muted">
        Computed by AirIQ from each station&rsquo;s concentrations (OpenAQ): PM2.5/PM10 24-hour means, the gases&rsquo; latest hour, CPCB breakpoints.{" "}
        {naqi.status === "ok"
          ? `${naqi.count} of ${naqi.checked} stations have enough data${naqi.method === "median" ? `; median ${formatIndex(naqi.median, "in")}` : ""}.`
          : (naqi.note ?? "")}{" "}
        WAQI US AQI of the same site is shown for comparison only.
      </p>
      {naqi.stations.length ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm" data-testid="station-naqi-table">
            <caption className="sr-only">India NAQI computed from station concentrations</caption>
            <thead className="sticky top-0 bg-surface text-xs">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 pr-2 font-semibold">NAQI</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Station</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">WAQI US AQI</th>
                <th scope="col" className="py-1.5 text-right font-semibold">Observed</th>
              </tr>
            </thead>
            <tbody>
              {naqi.stations.map((s) => {
                const m = matchStation(s, waqi, haversineKm);
                const ok = usable.has(s.id);
                const details = Object.entries(s.concentrations)
                  .map(([p, c]) => describeConcentration(p as keyof typeof NAQI_SHORT, c!))
                  .join("; ");
                return (
                  <tr key={s.id} className={`border-b border-border/60 align-top ${ok ? "" : "text-muted"}`} data-usable={ok ? "true" : "false"}>
                    <td className="py-1.5 pr-2">
                      {s.value !== null ? (
                        <span className="inline-flex items-center gap-1.5 font-mono font-bold tabular-nums">
                          <CategorySwatch category={getInCategory(s.value)} className="h-3 w-3" />
                          {formatIndex(s.value, "in")}
                        </span>
                      ) : (
                        "n/a"
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" title={details || undefined}>
                        {shortName(s.name)}
                      </a>
                      <span className="text-xs text-muted">
                        {" "}
                        · {s.distanceKm < 1 ? "<1" : s.distanceKm.toFixed(1)} km{s.provider ? ` · ${s.provider}` : ""}
                        {s.dominant ? ` · main ${NAQI_SHORT[s.dominant]}` : ""}
                      </span>
                      {!ok && s.reason ? <span className="block text-xs">Not used: {s.reason}</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-xs tabular-nums">{m ? `${formatIndex(m.aqi, "us")} (${shortName(m.name)})` : "no match"}</td>
                    <td className="py-1.5 text-right text-xs tabular-nums">
                      {s.observedAt ? (
                        <time dateTime={s.observedAt}>
                          {formatInZone(s.observedAt, timeZone, { hour: "2-digit", minute: "2-digit" })} · {timeAgo(s.observedAt, now)}
                        </time>
                      ) : (
                        "n/a"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
