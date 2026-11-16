# Phase 9b report: station-based NAQI and older readings

Verified on 16 Nov 2026 (about 21:00–21:45 IST) against the production build (`next build && next start`) with a real OpenAQ v3 key, WAQI token and Open-Meteo.

## Checks

- `npm run check`: typecheck, lint, 380 tests passing.
- `npm run build`: success; `/api/station-naqi` is a dynamic route.

## Live `/api/station-naqi`

| City | Result | Notes |
| --- | --- | --- |
| Delhi | median **326** of 14/15 stations | Highest Sirifort (CPCB) 505, shown as beyond index. Mandir Marg checked by hand: PM2.5 24 h mean 150.75 µg/m³ → sub-index 324. |
| Mumbai | median 131 of 12/15 | Others: fewer than 3 pollutants, or PM older than 3 h. |
| Kolkata | median 121 of 12/12 | Highest Ghusuri, Howrah 163. |
| Bengaluru | median 116 of 5/9 | 4 stations have fewer than 3 pollutants. |
| Sonipat | nearest 303 (Murthal, 1/1) | |
| London | none | One station, PM older than 3 h (the NAQI scale is meant for India). |

A repeat call is served from the 10-minute cache in about 0.08 s. A cold city takes 2–9 s.

CPCB stations on OpenAQ label NO₂, SO₂ and CO in "ppb", a label AirIQ does not trust for CPCB data. Those gases are skipped and listed per station, so many stations have only PM2.5, PM10 and O₃.

## Bugs found and fixed

1. **Rate-limited stations were reported as lacking data.** Kolkata, requested right after Delhi and Mumbai, had every station fail with "rate limit: next slot in 50 s", yet the result said "12 stations checked; none has enough data". Stations whose requests fail are now marked `fetchFailed`, and the summary returns `status: "error"` ("could not be fetched … temporarily unavailable").
2. **A partial fetch let one station stand in for the city.** Rate-limited Bengaluru returned "nearest station 180" (1 of 9 usable), while the full fetch a minute later gave a median of 116 over 5. With any failed fetches and fewer than 3 usable stations, the result is now an error. With 3 or more usable stations, the median stands.
3. **The client kept an error for 10 minutes.** `useStationNaqi` now refetches after 75 s when the summary is an error, which is after OpenAQ's per-minute window has reset.

Regression tests are in `lib/__tests__/phase9b.test.ts` ("fetch failures (e.g. rate limit) are an error …").

## Browser (headless Chrome, `/city/delhi-28.652-77.231?scale=in`)

- The gauge shows **324 India NAQI, Very poor**: "Median of 13 stations within 15 km · highest 398 at ITO (3 km)". Earlier, the model-based NAQI showed 188 "Moderately polluted".
- The episode banner, health advice ("Based on: Stations (median of 13)") and the methodology note follow the station NAQI.
- No console errors. `/api/station-naqi` returned HTTP 200.
- WAQI's station table showed current US AQI of about 130–160 at the same time. This is expected: NAQI uses 24-hour PM means, which still included the morning's higher hours, while WAQI shows the latest hour.
