# AirIQ: Real-Time Air Quality Intelligence

Built for the **BREATHE BETTER** hackathon. AirIQ shows live AQI, pollution maps, history, forecasts, alerts and an AI assistant, using only authentic public air-quality data.

> 🚧 Work in progress. Done so far: Phase 1 (scaffold, AQI engine, Open-Meteo data layer) and Phase 2 (dashboard).

## Features so far

- **Live dashboard** (`/`): search hero, "Use my location", favorites row and six popular cities, each with live AQI.
- **City page** (`/city/[slug]`): semicircular AQI gauge with category color, pattern and label; plain-English verdict; "Updated X min ago" with 10-minute auto-refresh and a manual Refresh button; six pollutant cards with sub-index color, WHO guideline ratio, dominant-pollutant badge and a 24-hour sparkline; in-app EPA cross-check.
- **US / European AQI toggle**, persisted and applied app-wide.
- **Favorites** in localStorage (star on the city header).
- **City search**: debounced WAI-ARIA combobox (arrow keys, Enter, Escape).
- **Dark/light theme**, persisted and applied before first paint (no flash). Mobile-first layout, visible focus rings, skip link.
- Every data view has a skeleton, an error state with Retry, and an empty state.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

No API keys are required. Optional keys (see `.env.example`) unlock extra station layers and the AI assistant.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `npm test` | AQI unit tests (Node's built-in test runner) |
| `npm run check` | typecheck + lint + tests |

Requires Node.js ≥ 22.18 (native TypeScript type-stripping is used for tests).

## API routes (so far)

| Route | Source | Notes |
| --- | --- | --- |
| `GET /api/geocode?q=&count=&lang=` | Open-Meteo Geocoding | City search, cached 24 h |
| `GET /api/air?lat=&lon=` | Open-Meteo Air Quality | Current reading, last 24 h, source sub-indices, in-app EPA cross-check, cached 10 min |
| (client) BigDataCloud reverse geocode | api.bigdatacloud.net | Labels "Use my location". No key, called from the browser |

All upstream calls are validated with Zod and normalized to the types in `types/air.ts`. Failures return `{ error, detail }` with a 4xx/5xx status. The app never substitutes made-up values.

## Project layout

```
app/            pages + route handlers (api/*)
components/     UI (AqiGauge, PollutantCard, CitySearch, CityDashboard, …)
hooks/          useCity (active city + useAir), useFavorites, useAqiScale, useGeolocation, …
lib/            aqi.ts, aqi-categories.ts, openmeteo.ts, schemas.ts, cache.ts, http.ts, slug.ts, storage.ts, …
types/          internal data model + API response types
```

## Decisions

- **Next.js 16.4.5** instead of the 15.x that `create-next-app@15` installs, because 15.x has open security advisories.
- **Tests use Node's built-in runner** (`node --test` with native type stripping) instead of Vitest. `npm install vitest` repeatedly crashed with an npm 10.9 internal error (`edgesOut`), and Vitest 4/5 don't officially support Node 23. The tested modules (`lib/aqi.ts`, `lib/aqi-categories.ts`) use relative `.ts` imports so they run without a bundler.
- **EPA breakpoints: May 2024 revision** (PM2.5 "Good" ≤ 9.0 µg/m³). The 2012 PM2.5 table is kept as an option for reference.
- **Headline AQI = Open-Meteo's `us_aqi` / `european_aqi`.** The in-app EPA calculation (proper 24 h / 8 h / 1 h averaging windows) is shown as a cross-check. Verified live: PM2.5 sub-indices match Open-Meteo exactly. Ozone can differ because Open-Meteo uses a different 8-hour window convention.
- **Dominant pollutant** comes from Open-Meteo's per-pollutant sub-indices (`us_aqi_pm2_5`, …), so it always agrees with the headline number. The European index has no CO component.
- **Gas unit conversion** µg/m³ → ppb/ppm at 25 °C, 1 atm (EPA reference conditions, molar volume 24.45 L).
- **WHO guideline comparison** uses WHO 2021 AQG values. For hourly readings: 24-hour guidelines for PM/NO₂/SO₂/CO and the 8-hour guideline for O₃.
- **Times** are normalized to UTC ISO strings. Each series keeps its `utcOffsetSeconds` so local hour-of-day patterns can still be computed.
- **Caching:** Next.js data cache (`revalidate: 600`) plus an in-process TTL cache with in-flight de-duplication.
- **Shareable city URLs** are `/city/<name>-<lat>-<lon>` with 3-decimal coordinates (~100 m), e.g. `/city/new-york-40.714--74.006`. The coordinates in the slug are authoritative. The server looks the name up in the geocoder only to recover "Region, Country" (same name within 50 km), and falls back to the slug name if the geocoder fails.
- **"Use my location"** navigates as soon as coordinates are known, to `/city/your-location-<lat>-<lon>`. The page loads air data right away and resolves a place name from BigDataCloud's free client endpoint in the background. When the name arrives, the URL is swapped (no reload) for a shareable named slug. If the lookup fails, the label stays "Your location (lat, lon)".
- **Gauge bands have equal width** (six per scale) so the low end stays readable on a 0–500 scale. The marker interpolates inside its band.
- **Pollutant card colors** come from Open-Meteo's per-pollutant sub-index on the active scale. The European index has no CO component, so the CO card says so instead of showing a color.
- **WHO comparison** compares the current hourly concentration with the WHO 2021 24-hour guideline (8-hour for O₃). This is an indicator, not a formal exceedance.
- **Errors show immediately.** SWR keeps retrying in the background, but the user sees the error and a Retry button (which shows "Retrying…") rather than a long skeleton. On a failed refresh, the last successful reading stays visible with a "Refresh failed" notice.
- **Theme** defaults to the OS preference until the user picks one.
- **Popular cities** are a fixed list of coordinates. Their readings are always fetched live.
- **Pages from later phases** (`/map`, `/compare`, `/alerts`, `/assistant`) show a "Coming in a later phase" page instead of a 404.
