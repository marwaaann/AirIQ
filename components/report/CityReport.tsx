"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { CategoryBadge, CategorySwatch } from "@/components/CategoryBadge";
import { CigaretteEquivalent } from "@/components/CigaretteEquivalent";
import { DISCLAIMER, useAdvice } from "@/components/health/advice-common";
import { offlineFallback } from "@/components/pwa/OfflineUnavailable";
import { ShareButton } from "@/components/ShareButton";
import { ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { useAqiScale } from "@/hooks/useAqiScale";
import { forecastUrl, historyUrl, useAir } from "@/hooks/useCity";
import { useProfile } from "@/hooks/useProfile";
import { getCategory, POLLUTANT_INFO, POLLUTANT_ORDER } from "@/lib/aqi-categories";
import { accentStyle, headline, SCALE_LABEL } from "@/lib/aqi-display";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { dailyRanges } from "@/lib/forecast-insights";
import { formatConcentration, formatLocalDate, formatPlaceTime } from "@/lib/format";
import { dailyStats, toLocalHours } from "@/lib/history-stats";
import { PROFILES } from "@/lib/profiles";
import { findSafeWindows } from "@/lib/safe-windows";
import { cityShareUrl, parseRange, parseSharedPrefs } from "@/lib/share";
import { combineStale, staleMetaOf } from "@/lib/stale";
import { datesEnding, localParts } from "@/lib/time";
import type { ForecastResponse, HistoryResponse } from "@/types/api";

/** Recharts loads only when the history chart renders. */
const HistoryChart = dynamic(
  () => import("@/components/history/HistoryChart").then((m) => m.HistoryChart).catch(offlineFallback("The history chart")),
  { ssr: false, loading: () => <Skeleton className="h-64" label="Loading chart" /> },
);

export interface ReportPlace {
  slug: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="report-section flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Print-friendly, shareable report. ?scale= and ?profile= override the saved settings for this view only. */
export function CityReport({ place }: { place: ReportPlace }) {
  const params = useSearchParams();
  const shared = parseSharedPrefs(params);
  const range = parseRange(params.get("range"));
  const rangeDays = Number(range) as 7 | 30 | 90;
  const [savedScale] = useAqiScale();
  const [savedProfile] = useProfile();
  const scale = shared.scale ?? savedScale;
  const profile = PROFILES[shared.profile ?? savedProfile.id];

  const air = useAir(place.latitude, place.longitude);
  const hist = useSWR<HistoryResponse, Error>(historyUrl(place.latitude, place.longitude, rangeDays), apiFetch, { revalidateOnFocus: false });
  const fc = useSWR<ForecastResponse, Error>(forecastUrl(place.latitude, place.longitude), apiFetch, { revalidateOnFocus: false });
  const advice = useAdvice(air.data, scale, profile.id);
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"pdf" | "png" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const h = air.data ? headline(air.data.current, scale) : null;
  const unit = scale === "us" ? "US AQI" : "EU AQI";

  const historyDays = useMemo(() => {
    if (!hist.data) return null;
    const tz = hist.data.series.timezone;
    const pts = hist.data.series.points;
    const end = pts.length ? localParts(pts[pts.length - 1].time, tz).date : localParts(hist.data.fetchedAt, tz).date;
    const inRange = new Set(datesEnding(end, rangeDays));
    const hours = toLocalHours(
      pts.map((p) => ({ time: p.time, value: scale === "us" ? p.usAqi : p.euAqi, subs: scale === "us" ? p.usSubIndices : p.euSubIndices })),
      tz,
    ).filter((x) => inRange.has(x.date));
    return dailyStats(hours);
  }, [hist.data, scale, rangeDays]);

  const forecast = useMemo(() => {
    if (!fc.data) return null;
    const tz = fc.data.official.timezone;
    const pts = fc.data.official.points.map((p) => ({ time: p.time, value: scale === "us" ? p.usAqi : p.euAqi }));
    const windows = findSafeWindows({
      points: pts,
      threshold: profile.defaultThreshold[scale],
      timeZone: tz,
      activity: "walk",
      minHours: 2,
      now: Date.parse(fc.data.now) + 1,
      sun: fc.data.sun,
    });
    // A stub of the current day (under 6 forecast hours left) is not a useful day row.
    const days = dailyRanges(pts, tz);
    return { days: (days[0] && days[0].n < 6 ? days.slice(1) : days).slice(0, 5), windows };
  }, [fc.data, scale, profile]);

  const fileBase = `airiq-${place.slug.split("-").slice(0, -2).join("-") || "report"}-${air.data ? air.data.current.time.slice(0, 13).replace(/[:T]/g, "-") : "now"}`;

  async function doExport(kind: "pdf" | "png") {
    const node = reportRef.current;
    if (!node) return;
    setExporting(kind);
    setExportError(null);
    try {
      const m = await import("@/lib/export-report");
      if (kind === "pdf") await m.exportReportPdf(node, `${fileBase}.pdf`);
      else await m.exportReportPng(node, `${fileBase}.png`);
    } catch (err) {
      setExportError(`Couldn't create the ${kind.toUpperCase()} (${err instanceof Error ? err.message : "unknown error"}). Try again, or use Print → Save as PDF.`);
    } finally {
      setExporting(null);
    }
  }

  const ready = Boolean(air.data);
  const btn = "inline-flex h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-start gap-2" aria-label="Report actions" role="toolbar">
        <Link prefetch={false} href={`/city/${place.slug}`} className={btn}>
          ← Back to {place.name}
        </Link>
        <button type="button" className={btn} disabled={!ready || exporting !== null} onClick={() => void doExport("pdf")} data-testid="download-pdf">
          {exporting === "pdf" ? "Creating PDF…" : "Download PDF"}
        </button>
        <button type="button" className={btn} disabled={!ready || exporting !== null} onClick={() => void doExport("png")} data-testid="download-png">
          {exporting === "png" ? "Creating PNG…" : "Download PNG"}
        </button>
        <button type="button" className={btn} onClick={() => window.print()}>
          Print
        </button>
        <ShareButton
          title={`Air quality report: ${place.name}`}
          text={h?.value !== null && h?.value !== undefined ? `${place.name}: ${unit} ${h.value} (${h.category?.label ?? ""}) · AirIQ` : `Air quality in ${place.name} · AirIQ`}
          getUrl={() => cityShareUrl(window.location.origin, { slug: place.slug, tab: "overview", range, scale, profile: profile.id }, "report")}
        />
      </div>
      {exportError ? (
        <p role="alert" className="no-print rounded-lg border border-danger/50 bg-danger/5 px-3 py-2 text-sm text-danger" data-testid="export-error">
          {exportError}
        </p>
      ) : null}

      <div ref={reportRef} className="report-root flex flex-col gap-4 bg-bg p-1" style={accentStyle(h?.category ?? null)} data-testid="report">
        <header className="flex flex-col gap-1 border-b-4 border-accent pb-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">AirIQ air-quality report</p>
          <h1 className="text-3xl font-bold tracking-tight">{place.name}</h1>
          <p className="text-sm text-muted">
            {place.subtitle ? `${place.subtitle} · ` : ""}
            {place.latitude.toFixed(3)}, {place.longitude.toFixed(3)} · {SCALE_LABEL[scale]} · {profile.label} profile
          </p>
          {air.data ? (
            <p className="text-sm" data-testid="report-timestamp">
              Data for <strong>{formatPlaceTime(air.data.current.time, air.data.current.timezone)}</strong> (model hour), fetched{" "}
              {new Date(air.data.fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC.
            </p>
          ) : null}
        </header>
        <StaleNotice
          meta={combineStale(staleMetaOf(air.data), staleMetaOf(hist.data), staleMetaOf(fc.data))}
          timeZone={air.data?.current.timezone ?? "UTC"}
          onRetry={() => {
            void air.mutate();
            void hist.mutate();
            void fc.mutate();
          }}
        />

        {air.error && !air.data ? (
          <ErrorState title="Couldn't load live air quality" message={errorMessage(air.error)} onRetry={() => void air.mutate()} retrying={air.isValidating} />
        ) : !air.data || !h ? (
          <Skeleton className="h-40 rounded-2xl" label="Loading report" />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Section title="Current air quality" id="r-now">
                <div className="flex items-center gap-3">
                  <span className="text-5xl font-bold" data-testid="report-aqi">
                    {h.value ?? "n/a"}
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{h.scaleLabel}</span>
                    {h.category ? <CategoryBadge category={h.category} /> : null}
                  </div>
                </div>
                <p className="text-sm">Main pollutant: {h.dominant ? POLLUTANT_INFO[h.dominant].short : "n/a"}</p>
                {h.category ? <p className="text-sm text-muted">{h.category.health}</p> : null}
              </Section>
              <Section title="Pollutants" id="r-poll">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="font-medium">
                        Pollutant
                      </th>
                      <th scope="col" className="font-medium">
                        µg/m³
                      </th>
                      <th scope="col" className="font-medium">
                        Sub-index
                      </th>
                      <th scope="col" className="font-medium">
                        vs WHO
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {POLLUTANT_ORDER.map((p) => {
                      const v = air.data!.current.pollutants[p];
                      const info = POLLUTANT_INFO[p];
                      const sub = h.subIndices[p];
                      return (
                        <tr key={p} className="border-t border-border">
                          <th scope="row" className="py-1 font-medium">
                            {info.short}
                          </th>
                          <td className="py-1 font-mono">{formatConcentration(v)}</td>
                          <td className="py-1 font-mono">{sub ?? "n/a"}</td>
                          <td className="py-1">{v !== null ? `${(v / info.who.value).toFixed(1)}× (${info.who.averaging} ${info.who.value})` : "n/a"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-muted">Current hourly values compared with WHO 2021 guideline values (which use longer averaging periods), for context only.</p>
              </Section>
            </div>

            <CigaretteEquivalent lat={place.latitude} lon={place.longitude} />

            <Section title={`Last ${rangeDays} days (daily ${unit})`} id="r-hist">
              {hist.error && !hist.data ? (
                <ErrorState compact title="Couldn't load history" message={errorMessage(hist.error)} onRetry={() => void hist.mutate()} />
              ) : !historyDays ? (
                <Skeleton className="h-64" label="Loading history" />
              ) : (
                <HistoryChart days={historyDays} metric="aqi" scale={scale} />
              )}
            </Section>

            <div className="grid gap-4 md:grid-cols-2">
              <Section title="5-day forecast (official CAMS)" id="r-fc">
                {fc.error && !fc.data ? (
                  <ErrorState compact title="Couldn't load the forecast" message={errorMessage(fc.error)} onRetry={() => void fc.mutate()} />
                ) : !forecast ? (
                  <Skeleton className="h-40" label="Loading forecast" />
                ) : forecast.days.length === 0 ? (
                  <p className="text-sm text-muted">The forecast has no values.</p>
                ) : (
                  <table className="w-full text-left text-sm" data-testid="report-forecast">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th scope="col" className="font-medium">
                          Day
                        </th>
                        <th scope="col" className="font-medium">
                          Range
                        </th>
                        <th scope="col" className="font-medium">
                          Worst category
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.days.map((d) => {
                        const cat = getCategory(d.max, scale);
                        return (
                          <tr key={d.date} className="border-t border-border">
                            <th scope="row" className="py-1 font-medium">
                              {formatLocalDate(d.date)}
                              {d.n < 24 ? <span className="text-xs font-normal text-muted"> ({d.n} h)</span> : null}
                            </th>
                            <td className="py-1 font-mono">
                              {Math.round(d.min)}–{Math.round(d.max)}
                            </td>
                            <td className="py-1">
                              <span className="inline-flex items-center gap-1.5">
                                <CategorySwatch category={cat} className="h-3 w-3" /> {cat.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title={`Health advice · ${profile.label}`} id="r-health">
                {advice ? (
                  <>
                    <p className="font-semibold">{advice.headline.text}</p>
                    <ul className="list-disc pl-5 text-sm">
                      {advice.activity
                        .flatMap((g) => g.items)
                        .slice(0, 3)
                        .map((r) => (
                          <li key={r.id}>{r.text}</li>
                        ))}
                      {advice.indoor.slice(0, 1).map((r) => (
                        <li key={r.id}>{r.text}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted">Health advice needs a current AQI reading.</p>
                )}
                <h3 className="mt-2 text-sm font-semibold">Safe times for a 2-hour walk (next 48 h, {unit} ≤ {profile.defaultThreshold[scale]})</h3>
                {!forecast ? (
                  <Skeleton className="h-12" />
                ) : forecast.windows.status === "ok" ? (
                  <ul className="text-sm" data-testid="report-windows">
                    {forecast.windows.windows.map((w) => (
                      <li key={w.start}>
                        {w.label} · {unit} {Math.round(w.min)}–{Math.round(w.max)}
                      </li>
                    ))}
                  </ul>
                ) : forecast.windows.status === "none" ? (
                  <p className="text-sm" data-testid="report-windows">
                    No 2-hour window stays at or below {profile.defaultThreshold[scale]}.
                    {forecast.windows.leastBad[0] ? ` Least-bad: ${forecast.windows.leastBad[0].label} (${Math.round(forecast.windows.leastBad[0].max)} at worst).` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted">The forecast has no values for the next 48 hours.</p>
                )}
              </Section>
            </div>

            <footer className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted" data-testid="report-sources">
              <p>
                <strong className="text-text">Sources:</strong> Open-Meteo Air Quality API (Copernicus CAMS model data) for current values, history and the official forecast;
                Open-Meteo Geocoding; Berkeley Earth (cigarette equivalence). AQI categories per {scale === "us" ? "US EPA (2024 breakpoints)" : "the EEA European Air Quality Index"};
                health guidance per {scale === "us" ? "US EPA AirNow" : "EEA"} with WHO 2021 guideline values.
              </p>
              <p>
                <strong className="text-text">{DISCLAIMER}</strong> Values are model estimates for the location, not station measurements. Generated by AirIQ
                {air.data ? ` from data fetched ${new Date(air.data.fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}.
              </p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
