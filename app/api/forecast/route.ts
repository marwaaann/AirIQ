import type { NextRequest } from "next/server";

import { cached } from "@/lib/cache";
import { pm25SeriesToIndex } from "@/lib/forecast-insights";
import { DEFAULT_HORIZON, runTrendModel } from "@/lib/forecast-model";
import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { getAirSeries, getSunTimes } from "@/lib/openmeteo";
import { LatLonQuerySchema } from "@/lib/schemas";
import { localParts } from "@/lib/time";
import type { ForecastResponse, ModelPayload } from "@/types/api";

const FORECAST_TTL = 15 * 60;
const TRAIN_DAYS = 28;

/**
 * GET /api/forecast?lat=&lon=
 * Official 5-day hourly CAMS forecast (Open-Meteo) from the current hour, plus
 * the AirIQ trend model trained on the last 28 days of hourly PM2.5 with its
 * backtest and 80% intervals. Cached 15 minutes.
 */
export async function GET(req: NextRequest) {
  try {
    const { lat, lon } = parseQuery(req.nextUrl.searchParams, LatLonQuerySchema);
    const key = `forecast:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const body = await cached<ForecastResponse>(key, FORECAST_TTL, async () => {
      // Sun times are optional: a failure there must not break the forecast.
      const [series, sun] = await Promise.all([
        getAirSeries(lat, lon, TRAIN_DAYS, 5, FORECAST_TTL),
        getSunTimes(lat, lon, 3).catch(() => null),
      ]);
      const pts = series.points;
      const nowMs = Date.now();
      let nowIdx = -1;
      for (let i = 0; i < pts.length; i++) if (Date.parse(pts[i].time) <= nowMs) nowIdx = i;
      if (nowIdx < 0) nowIdx = 0;

      const tz = series.timezone;
      const history = pts.slice(0, nowIdx + 1);
      const values = history.map((p) => p.pollutants.pm2_5);
      const hours = history.map((p) => localParts(p.time, tz).hour);
      const t0 = Date.parse(pts[nowIdx].time);
      const futureTimes = Array.from({ length: DEFAULT_HORIZON }, (_, k) => new Date(t0 + (k + 1) * 3600_000).toISOString());
      const futureHours = futureTimes.map((t) => localParts(t, tz).hour);

      const result = runTrendModel(values, hours, futureHours);
      let model: ModelPayload;
      if (result.status === "ok") {
        const pm = result.forecast.map((p) => p.value);
        const lo = result.forecast.map((p) => p.lo);
        const hi = result.forecast.map((p) => p.hi);
        const us = pm25SeriesToIndex(values, pm, "us");
        const usLo = pm25SeriesToIndex(values, lo, "us");
        const usHi = pm25SeriesToIndex(values, hi, "us");
        const eu = pm25SeriesToIndex(values, pm, "eu");
        const euLo = pm25SeriesToIndex(values, lo, "eu");
        const euHi = pm25SeriesToIndex(values, hi, "eu");
        const inn = pm25SeriesToIndex(values, pm, "in");
        const inLo = pm25SeriesToIndex(values, lo, "in");
        const inHi = pm25SeriesToIndex(values, hi, "in");
        const strip = ({ mae, rmse, n }: { mae: number; rmse: number; n: number }) => ({ mae, rmse, n });
        model = {
          status: "ok",
          params: result.params,
          trainHours: result.trainHours,
          validHours: result.validHours,
          backtest: {
            holdout: result.backtest.holdout,
            trainHours: result.backtest.trainHours,
            model: strip(result.backtest.model),
            persistence: strip(result.backtest.persistence),
            seasonalNaive: strip(result.backtest.seasonalNaive),
          },
          intervals: result.intervals,
          points: result.forecast.map((p, i) => ({
            time: futureTimes[i],
            k: p.k,
            pm25: p.value,
            pm25Lo: p.lo,
            pm25Hi: p.hi,
            us: us[i],
            usLo: usLo[i],
            usHi: usHi[i],
            eu: eu[i],
            euLo: euLo[i],
            euHi: euHi[i],
            in: inn[i],
            inLo: inLo[i],
            inHi: inHi[i],
          })),
        };
      } else {
        model = result;
      }

      return {
        official: { ...series, points: pts.slice(nowIdx) },
        now: pts[nowIdx].time,
        model,
        sun,
        fetchedAt: new Date().toISOString(),
      };
    });
    return jsonOk<ForecastResponse>(body, FORECAST_TTL);
  } catch (err) {
    return handleRouteError(err);
  }
}
