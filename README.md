# AirIQ: Real-Time Air Quality Intelligence

Built for the **BREATHE BETTER** hackathon. AirIQ shows live AQI, pollution maps, history, forecasts, alerts and an AI assistant, using only authentic public air-quality data.

> 🚧 Work in progress. Done so far: Phase 1 (scaffold, AQI engine, Open-Meteo data layer), Phase 2 (dashboard) and Phase 3 (map, heatmap, stations).

## Features so far

- **Live dashboard** (`/`): search hero, "Use my location", favorites row and six popular cities, each with live AQI.
- **City page** (`/city/[slug]`): semicircular AQI gauge with category color, pattern and label; plain-English verdict; "Updated X min ago" with 10-minute auto-refresh and a manual Refresh button; six pollutant cards with sub-index color, WHO guideline ratio, dominant-pollutant badge and a 24-hour sparkline; in-app EPA cross-check.
- **US / European AQI toggle**, persisted and applied app-wide.
- **Favorites** in localStorage (star on the city header).
- **City search**: debounced WAI-ARIA combobox (arrow keys, Enter, Escape).
- **Dark/light theme**, persisted and applied before first paint (no flash). Mobile-first layout, visible focus rings, skip link.
- **Pollution map** (`/map`): live Open-Meteo grid (up to 64 points per view, one batched request) with value badges; an inverse-distance-weighted heatmap with adjustable opacity; layers for AQI, PM2.5, PM10, NO₂ and O₃; popups with all six pollutants and a link to the full dashboard; optional ground stations (WAQI or OpenAQ); fly-to search and "Use my location"; shareable URL (`?lat=&lon=&z=&layer=`); bottom-sheet controls on mobile.
- Every data view has a skeleton, an error state with Retry, and an empty state.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

No API keys are required. Optional keys go in `.env.local` (template: `.env.example`):

| Variable | Used for | Without it |
| --- | --- | --- |
| `WAQI_TOKEN` | Ground-station markers on the map (preferred source) | Falls back to OpenAQ, or no stations |
| `OPENAQ_API_KEY` | Ground-station markers on the map (fallback source) | No stations ("Ground stations: not configured") |
| `GEMINI_API_KEY` | AI assistant (Phase 6) | Assistant shows "key not configured" |

Keys are read only inside route handlers and never reach the browser.

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
| `GET /api/grid?south=&west=&north=&east=&zoom=` | Open-Meteo Air Quality (batched multi-location) | ≤64 snapped grid points, current AQI + pollutants + per-pollutant sub-indices, cached 10 min. 400 on inverted or oversized bounds |
| `GET /api/stations?south=&west=&north=&east=&zoom=` | WAQI `/map/bounds/` → OpenAQ v3 `/locations` + `/locations/{id}/latest` | `{ source: "none", stations: [] }` when no key is set; cached 10 min |
| (client) BigDataCloud reverse geocode | api.bigdatacloud.net | Labels "Use my location" and map points. No key, called from the browser |
| (client) Esri World Gray Canvas tiles | server.arcgisonline.com | Light/dark basemap and labels. No key |

All upstream calls are validated with Zod and normalized to the types in `types/air.ts`. Failures return `{ error, detail }` with a 4xx/5xx status. The app never substitutes made-up values.

## Project layout

```
app/            pages + route handlers (api/*)
components/     UI (AqiGauge, PollutantCard, CitySearch, CityDashboard, …)
components/map/ MapScreen → MapClient (client-only) → MapView (react-leaflet), HeatLayer, MapControls, markers, popups
hooks/          useCity (active city + useAir), useFavorites, useAqiScale, useGeolocation, …
lib/            aqi.ts, aqi-categories.ts, openmeteo.ts, waqi.ts, openaq.ts, stations.ts, grid.ts, idw.ts, color-ramp.ts, schemas.ts, cache.ts, http.ts, slug.ts, storage.ts, …
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
- **Basemap: Esri World Light/Dark Gray Canvas instead of CARTO.** The spec asked for CARTO light/dark tiles, but on 2026-11-10 every CARTO basemap URL returned an "API KEY REQUIRED" watermark tile, which would break the zero-keys rule. Esri's gray canvas tiles need no key, come in matching light/dark styles, and are attributed on the map. A separate Esri label layer sits above the heatmap so place names stay readable. Esri's terms allow this for non-commercial and development use; a production deployment should review Esri's or another provider's terms.
- **Grid snapping.** Grid points sit on multiples of a "nice" step (0.1°, 0.2°, 0.25°, 0.5°, 1°, …). The finest step depends on zoom (~16 points across a typical viewport); the grid coarsens until it fits 64 points. Slightly panned views produce identical points, so they share cache entries. A viewport larger than a 16-tile-wide screen at its zoom is rejected with a 400.
- **One request per grid.** All grid points go to Open-Meteo in a single comma-separated multi-location request. If Open-Meteo fails or rate-limits (429 is passed through), the route returns that error and the map keeps the last successful view with an error banner. It never fills gaps with invented values.
- **Map colors follow the app's AQI toggle.** The AQI layer uses US or European AQI; pollutant layers are colored by that pollutant's Open-Meteo sub-index on the active scale, while badges show the concentration in µg/m³.
- **Heatmap** is a custom canvas layer (no leaflet.heat). It interpolates grid values in screen space with inverse-distance weighting (power 2), draws at 1/6 resolution with smoothing, and fades out beyond ~1.6 grid spacings so it never paints far past real data.
- **Ground stations** report a US AQI only. WAQI's map endpoint gives the network's AQI but not the dominant pollutant or per-pollutant values, so the popup says so. OpenAQ gives the latest hourly PM2.5, from which AirIQ computes an instantaneous US AQI, labeled as such. Stations without a numeric, recent (≤6 h) value are dropped. OpenAQ is capped at 20 stations per view to respect its free rate limit. Stations show on the AQI and PM2.5 layers only.
- **Station path testing:** no WAQI or OpenAQ key was available. The station UI was verified against a mocked `/api/stations` response in the browser, and the server path was tested live with invalid keys (WAQI "Invalid key" → OpenAQ 401 → clean 502, map still works). The successful live parsing of WAQI/OpenAQ responses has **not** been verified against real data.
- **Stale responses never win.** Map requests are debounced 500 ms. Each new request aborts the previous one, and a sequence check ignores any response that is not the latest.
- **Unnamed map points** link to `/city/map-point-<lat>-<lon>`. Like "Use my location", the page labels itself via BigDataCloud and swaps to a named URL (e.g. `/city/gurugram-28.5-77`).
- **`turbopack.root` is pinned** to the project folder in `next.config.ts`. A stray `package-lock.json` in a parent folder (here, the user's home directory) otherwise made the dev server watch far more than the project, and it fell into a full-reload loop while a browser was open.
