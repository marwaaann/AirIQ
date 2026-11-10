# AirIQ: Real-Time Air Quality Intelligence

Built for the **BREATHE BETTER** hackathon. AirIQ shows live AQI, pollution maps, history, forecasts, alerts and an AI assistant, using only authentic public air-quality data.

> 🚧 Work in progress. Done so far: Phase 1 (scaffold, AQI engine, Open-Meteo data layer), Phase 2 (dashboard), Phase 3 (map, heatmap, stations), Phase 4 (history, forecast, trend model), Phase 5 (health advice, smart alerts) and Phase 6 (AI assistant).

## Features so far

- **Live dashboard** (`/`): search hero, "Use my location", favorites row and six popular cities, each with live AQI.
- **City page** (`/city/[slug]`): semicircular AQI gauge with category color, pattern and label; plain-English verdict; "Updated X min ago" with 10-minute auto-refresh and a manual Refresh button; six pollutant cards with sub-index color, WHO guideline ratio, dominant-pollutant badge and a 24-hour sparkline; in-app EPA cross-check.
- **US / European AQI toggle**, persisted and applied app-wide.
- **Favorites** in localStorage (star on the city header).
- **City search**: debounced WAI-ARIA combobox (arrow keys, Enter, Escape).
- **Dark/light theme**, persisted and applied before first paint (no flash). Mobile-first layout, visible focus rings, skip link.
- **Pollution map** (`/map`): live Open-Meteo grid (up to 64 points per view, one batched request) with value badges; an inverse-distance-weighted heatmap with adjustable opacity; layers for AQI, PM2.5, PM10, NO₂ and O₃; popups with all six pollutants and a link to the full dashboard; optional ground stations (WAQI or OpenAQ); fly-to search and "Use my location"; shareable URL (`?lat=&lon=&z=&layer=`); bottom-sheet controls on mobile.
- **City tabs** (`?tab=overview|forecast|history`). Chart code is lazy-loaded, so the Overview tab ships no chart library.
- **History** (`?range=7|30|90`): daily mean/max chart with category bands (or any single pollutant with its WHO line), a calendar heatmap with patterns and a partial-day state, a weekday × hour heatmap, best/worst day, average, change vs the previous period, typical peak hour, and plain-English insights generated only when the numbers support them.
- **Forecast**: the official 5-day hourly CAMS forecast with the AirIQ trend model and its 80% range for 48 h, a "now" marker, a daily min/mean/max strip, an agreement indicator, backtest numbers against two baselines, and the cleanest 3-hour windows in the next 48 h (with a warning when even those are unhealthy).
- **Health advice** (`?tab=health`, plus a compact card on Overview): six profiles (General, Asthma/respiratory, Older adult, Children, Pregnancy, Athlete). Recommendations are grouped into outdoor activity (walking, exercise, commuting, children's play), indoor air and protection. Each shows its source, with a "why" line and the disclaimer "General information, not medical advice."
- **Safe-time finder:** windows in the next 48 h of the official forecast that stay at or below your profile's threshold, for walking, exercise (optionally daylight only, from Open-Meteo sunrise/sunset) or airing out your home (cleanest hours).
- **Smart alerts** (`/alerts`): rules per city for AQI, PM2.5, PM10, NO₂ or O₃ on the US or EU scale, on the current reading or the official forecast (next 6/12/24/48 h), with optional quiet hours. Includes a header bell with unread count, on-screen messages, opt-in browser notifications and an alert history. **Alerts only run while AirIQ is open in a browser tab.**
- **AI assistant** (`/assistant`, plus an "Ask AirIQ" sheet on every city page): Gemini with tool calling. It answers only from data its tools fetch (current AQI, history, forecast, comparisons, health advice, safe windows). Every answer shows which tools ran and a "Data used" panel with their arguments and key values. Streaming, Stop, Clear chat, quick prompts, and the transcript kept in sessionStorage. Without `GEMINI_API_KEY` it shows "Assistant not configured" and everything else works.
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
| `GEMINI_API_KEY` | AI assistant | Assistant shows "Assistant not configured" |
| `GEMINI_MODEL` | Override the Gemini model | `gemini-3.6-flash` |

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
| `GET /api/history?lat=&lon=&days=7\|30\|90` | Open-Meteo Air Quality (`past_days`) | Hourly AQI (both scales), 6 pollutants and per-pollutant sub-indices; fetches 2× the range (max 92 days) for period-over-period; future hours dropped; cached 30 min |
| `GET /api/forecast?lat=&lon=` | Open-Meteo Air Quality (`past_days=28`, `forecast_days=5`) + Open-Meteo Weather (`daily=sunrise,sunset`) | Official forecast from the current hour, AirIQ trend model, backtest and intervals, and 3 days of sunrise/sunset (`sun: null` if that call fails); cached 15 min |
| `GET /api/stations?south=&west=&north=&east=&zoom=` | WAQI `/map/bounds/` → OpenAQ v3 `/locations` + `/locations/{id}/latest` | `{ source: "none", stations: [] }` when no key is set; cached 10 min |
| `GET /api/assistant` | n/a | `{ configured, model }` (never the key) |
| `POST /api/assistant` | Google Gemini (`@google/genai`) + AirIQ tools | `{ messages ≤20, context? }`, user messages ≤2,000 chars → `text/event-stream` with `safety`, `text`, `tool_start`, `tool_result`, `retry`, `notice`, `done`, `error` events; 503 without a key; 429 + `Retry-After` when rate-limited; 400 on invalid input |
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

## AirIQ trend model

A transparent, dependency-free model in [`lib/forecast-model.ts`](lib/forecast-model.ts). It forecasts **hourly PM2.5** 48 h ahead. It is compared with the official forecast, never ranked above it.

**Method: additive Holt-Winters with a damped trend and a 24-hour season, on x = ln(1 + PM2.5).** With h(t) the city's true local hour:

```
forecast  x̂(t+k) = ℓ(t) + (φ + φ² + … + φᵏ)·b(t) + s[h(t+k)]
level     ℓ(t)   = α·(x(t) − s[h(t)]) + (1 − α)·(ℓ(t−1) + φ·b(t−1))
trend     b(t)   = β·(ℓ(t) − ℓ(t−1)) + (1 − β)·φ·b(t−1)
season    s[h(t)] ← γ·(x(t) − ℓ(t)) + (1 − γ)·s[h(t)]
output    PM2.5 = max(0, e^x̂ − 1)
```

- **Training data:** the last 28 days of hourly PM2.5 (Open-Meteo/CAMS), up to the current hour. The season starts as the per-hour mean minus the overall mean of the first 7 days.
- **Missing hours never update the state.** Level and trend roll forward and the season is left alone, so gaps are never filled with invented values.
- **Parameters:** α ∈ {0.05…0.7}, β ∈ {0, 0.02, 0.1}, γ ∈ {0.05, 0.15, 0.3}, φ ∈ {0.85, 0.95}, chosen by grid search on **multi-step** error (forecasts 1–24 h ahead from an origin every 6 h). Scoring by one-step error alone picked α = 0.7, which chased short-lived noise and biased the 24–48 h forecasts.
- **Backtest:** hold out the last 48 h, fit on the rest only, and report PM2.5 MAE and RMSE for the model, **persistence** (last value) and **seasonal-naive** (same local hour on the last training day), compared on the same hours. A unit test proves that changing the held-out hours does not change any prediction.
- **80% range:** the 10th–90th percentile of residuals (actual − predicted) from rolling-origin backtests (origins every 24 h over the last week; parameters fitted only on data before the earliest origin), separately for 1–6 h, 7–24 h and 25–48 h ahead. If the model has recently been biased, the range can sit entirely above or below its line; the UI says so.
- **On the AQI scale:** US uses the EPA index of the trailing 24-h mean (observed hours + predictions); EU uses the hourly EEA bands. These match how Open-Meteo builds its PM2.5 sub-indices, so the model line is compared with the official **PM2.5 sub-index** (dotted). The official headline line includes all pollutants. Converting the 80% range through the 24-h mean is an approximation.
- **Refusal:** with fewer than 216 valid hours (7 days + the 48-h holdout), more than 25% of hours missing, or too few residuals for every horizon bucket, the UI shows "Not enough data for a trend model".

**Backtest results on live data (2026-11-10, PM2.5 MAE / RMSE in µg/m³, last 48 h held out):**

| City | Model | Persistence | Seasonal-naive | Verdict |
| --- | --- | --- | --- | --- |
| Delhi | 22.5 / 26.8 | 32.7 / 42.9 | 25.0 / 29.9 | beats both |
| Beijing | 37.9 / 46.8 | 61.4 / 74.0 | 58.1 / 70.2 | beats both |
| New York | 2.4 / 2.8 | 2.9 / 3.1 | 7.2 / 10.2 | beats both |
| Los Angeles | 4.6 / 5.7 | 6.2 / 7.4 | 4.9 / 6.0 | beats both (narrowly) |
| Mumbai | 7.1 / 9.9 | 10.2 / 13.7 | 6.8 / 8.6 | **loses to seasonal-naive** |
| London | 12.5 / 13.3 | 9.4 / 10.7 | 8.9 / 10.2 | **loses to both** |

These change every hour with new data. The UI always shows the current numbers and says plainly when the model does not beat a baseline.

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
- **Local time (fix to Phase 1's handling).** Open-Meteo's `timezone=auto` labels every hour with ONE fixed offset (the zone's current one), not true wall-clock time. This was verified live: London returned 24 hourly stamps on 2026-10-25, the day BST ended. Phase 1's UTC conversion (label − `utc_offset_seconds`) is therefore exact, but bucketing by Open-Meteo's local labels would put London's summer days an hour off. AirIQ now derives the true local date, hour and weekday from UTC with the IANA zone (`lib/time.ts`), for daily buckets, hour-of-day patterns, "today" and chart labels. The browser's own time zone is never used.
- **European PM2.5 index** (`euPm25Index` in `lib/aqi.ts`) uses the HOURLY concentration with the 2024 EEA bands (0–5–15–50–90–140 µg/m³ → 0–20–40–60–80–100), continuing above 140 µg/m³ with the last band's slope. This was reverse-checked against 744 hourly Open-Meteo values each for Delhi and London: exact below 140 µg/m³, within ±1 above.
- **History periods** are the N local days ending today, inclusive; today is usually a partial day. Days with fewer than 18 valid hours are "partial": they are shown dashed and faded in the calendar and excluded from best/worst unless no full day exists. Hour-of-day cells need at least 3 samples. "vs previous period" needs at least 75% coverage of the earlier period and 50% of the current one. Open-Meteo keeps only 92 days, so the 90-day view has no previous period and says so.
- **Daily-mean independent check:** Delhi's 4 Nov and 8 Nov 2026 daily means were recomputed from the raw `/api/history` JSON with a plain +05:30 shift (no app code): 207.38 → 207 and 177.17 → 177, with max 219 and 181 and 24/24 hours. Both match the calendar exactly.
- **Insights** are generated only when the data supports them. A peak-hour line needs ≥12 hours with data and a peak-to-low spread of at least max(5, 15% of the mean). A change line needs |change| ≥ 10%, or < 5% to say "about the same". The category-share line needs ≥3 full days.
- **"Best time outside"** lists the 3 cleanest non-overlapping 3-hour windows in the next 48 h of the OFFICIAL forecast, never bridging gaps. When even those are "Unhealthy"/"Poor" or worse, the UI says there is no good window. The personalised health engine comes in Phase 5.
- **Browser verification used a production build** (`next start`). After many file edits during a long `next dev` session, the dev server again fell into a "[Fast Refresh] rebuilding" full-reload loop, even with `turbopack.root` pinned. A freshly started dev server did not loop. If it happens, restart `npm run dev`. The VS Code "Console Ninja" extension also injects into this dev server; whether it plays a part is unconfirmed.

### Phase 5: health advice and alerts

- **Alerts only run while a tab is open.** There is no server, service worker or push service: if every AirIQ tab is closed, nothing is checked or sent. With a tab open, alerts are re-checked every 10 minutes, when the tab becomes visible again, and on "Check now". The alerts page says this in an always-visible note.
- **Browser notifications** are requested only from the "Enable browser notifications" button, never on load. They use `new Notification()` from the page. Browsers that only allow notifications from a service worker (for example Chrome on Android) refuse this, and AirIQ then falls back to in-app alerts only (bell, history, on-screen message). If permission is denied or unsupported, alerts still work in-app and the page explains why.
- **One rules table** (`lib/health-rules.ts`). Every recommendation is a row with match conditions (scale, category rank, sensitive or general, main pollutant group, profile, local hour, PM2.5 above the WHO guideline) and a `basis` naming its source. The engine (`lib/health-advice.ts`) only selects and orders rows; the only substitution is the WHO ratio number. A unit test checks every scale × category × profile × main pollutant combination for a complete, sourced result.
- **Sources:** the US EPA AirNow Air Quality Guides (activity guidance by category and sensitive group) for the US AQI. The EEA European Air Quality Index recommendations for the European AQI, because the EPA text is defined in US AQI categories. The EPA Wildfire Smoke Guide and the EPA Guide to Air Cleaners in the Home for windows, purifiers and respirators. WHO 2021 guideline values.
- **Sensitive groups depend on the pollutant** (`lib/profiles.ts`), following EPA:
  - Asthma/respiratory: particles, ozone, NO₂, SO₂.
  - Older adults: particles, ozone, SO₂.
  - Children: particles, ozone, NO₂, SO₂.
  - Athletes ("people active outdoors"): ozone only.
  - Pregnancy: particles only, from the EPA Wildfire Smoke Guide.

  So an athlete gets general-public advice when PM2.5 is the main pollutant, and the "why" line says so. Verified live: London on 2026-11-10 (PM2.5-driven) showed identical advice for General and Athlete, while Delhi showed clearly stricter advice for Asthma than for General.
- **Masks:** a respirator is mentioned only for particles, at Unhealthy+ (Poor+ on the EU scale) for everyone, or USG+ (Moderate+) for sensitive profiles. It always says it must fit well and seal, and that cloth and surgical masks do little against fine particles. For gases the advice states that masks, including N95s, do not filter ozone, NO₂, SO₂ or CO.
- **Profile thresholds:** sensitive profiles tighten at the EPA "Unhealthy for Sensitive Groups" line (US 101; EU 40, where EEA sensitive-group advice starts). The default alert and safe-time threshold is 100 US / 40 EU for sensitive profiles and 150 US / 60 EU for General. Alerts fire when the value goes **above** the threshold; safe windows need the value **at or below** it.
- **Pollutant alerts compare the pollutant's sub-index on the rule's scale** (Open-Meteo's `us_aqi_pm2_5`, `european_aqi_ozone`, …), not µg/m³, so every threshold is an index on a stated scale. Thresholds are stored with their scale and compared only against that scale's value.
- **Hysteresis:** a rule fires once per episode. A current-reading rule re-arms only after the value falls below 90% of the threshold. A forecast rule re-arms once no forecast hour in its window exceeds the threshold. A forecast alert names the first exceeding span in the city's local time, e.g. "Forecast: US AQI above 207 in Delhi on Tue 13:00–Wed 12:00 local time (official forecast)."
- **Quiet hours** use the city's time zone, can cross midnight, and suppress only the browser notification. The event is still logged and shown, marked "suppressed (quiet hours)".
- **Shared requests:** the alert engine is mounted once in the layout and runs one watcher per city. It uses the same SWR keys as the city page (`/api/air`, `/api/forecast`), so rules for one city share requests with each other and with the dashboard.
- **Multiple tabs** share rule state through localStorage, so an episode normally fires once across tabs. There is no cross-tab lock, so two tabs evaluating in the same instant could, rarely, both notify.
- **Stored data is validated on every read.** Non-JSON or wrongly shaped values are removed and replaced with defaults. Lists (rules, events) keep their valid items and the cleaned list is written back. Verified in the browser by loading the app with garbage in every AirIQ key.
- **Safe-time finder:** the window is exactly the next 48 hourly slots. Runs never bridge missing hours. "Daylight only" (exercise only, off by default) splits runs at sunset/sunrise rather than rejecting long runs. If no window qualifies, the least-bad windows are listed and labelled as above the threshold. "Open windows" always lists the cleanest hours.
- **How notifications were verified:** headless Chrome cannot show notifications, so the browser tests replaced `window.Notification` with a wrapper that records each one created (with permission granted through the DevTools protocol), and counted those. Clicking a real notification (focus the tab, go to the city) could not be exercised headlessly.

### Phase 6: AI assistant

- **Model: `gemini-3.6-flash` by default, overridable with `GEMINI_MODEL`.** Chosen from Google's models page (checked 2026-11-10), which lists `gemini-3.6-flash` as **Stable** and in the Flash (fast, low-cost) tier. `gemini-3.8-flash` is newer but carries no "Stable" label. `gemini-3.5-flash-lite` is cheaper, but the Flash tier is the safer choice for multi-step tool calling. `gemini-2.5-flash` (the old placeholder default in `.env.example`) is deprecated, with requests re-routed from 2026-12-01.
- **API surface: the official `@google/genai` SDK (v3.0.0) with `models.generateContentStream`.** Google now recommends the newer Interactions API for new projects. Its docs pages, however, don't document the stateless conversation format, the streaming event shapes or the output-token limit that this route needs. They also state that `generateContent` "remains fully supported". Every request field used here (`systemInstruction`, `maxOutputTokens`, `tools[].functionDeclarations[].parametersJsonSchema`, `toolConfig.functionCallingConfig.mode`, `abortSignal`) was taken from the installed SDK's type definitions, and the exact HTTP request it sends was confirmed with a mocked `fetch`. Moving to the Interactions API is a possible later step.
- **Server-side tool loop** (`lib/assistant/loop.ts`). Stream the model, run requested tools in parallel, send results back as `functionResponse` parts, repeat. It stops after **6 tool rounds**: the next call is made with function calling set to `NONE`, and the UI shows a notice. Output is capped at 1,024 tokens per call. Model turns are sent back exactly as received, including thought signatures.
- **Tools call the app's own library functions directly** (`lib/assistant/tools.ts` with an injected data layer; `lib/assistant/data-layer.ts` wires in `lib/openmeteo.ts`). Arguments are validated with Zod. Bad arguments or data failures return an `{ status: "error" }` object to the model, never an exception. Every result carries values, units, the time zone, the source and the data time in local time.
- **City resolution:** `resolve_city` returns one city only when there's a single match or the top match is at least 10× more populous than the next (London, UK vs London, Ontario). Otherwise it returns the top 3 candidates and the model must ask, as with Springfield. "City, Region" narrows the results.
- **Grounding approach:**
  1. The system prompt requires tools for every fact and treats tool results, page context and place names as data, never instructions.
  2. Page context is sent as a labelled data block.
  3. A deterministic numeric guard (`lib/assistant/grounding-check.ts`) checks the final answer. It extracts numbers with a unit (µg/m³, %, ×) or AQI/index context and matches them, within the rounding shown, against numbers in this turn's tool results.
  4. AQI claims may only match index-like fields (AQI, means, max, min, thresholds, history insights), so a coincidental concentration or coordinate can't support them.
  5. Clock times, dates, durations, ordinals and pollutant names are ignored. A number the user typed is exempt only when used as a comparison ("above 150"); asserted as a reading ("the AQI **is** 10") it must come from a tool.
  6. On a mismatch the model gets one automatic retry naming the unsupported values. If it still fails, the answer is shown with "Some figures in this answer could not be matched to fetched data. Please check the data panel." The guard never blocks a response.
- **Emergency symptoms:** a deterministic server-side check (chest pain, severe difficulty breathing, fainting and similar phrases) sends a fixed "seek urgent medical care" message before anything the model says.
- **Rate limit: 20 requests per 10 minutes per IP, in memory.** It is per server instance and resets on restart, so it is **not suitable for multi-instance production**; use a shared store (e.g. Redis) there. Responses are 429 with `Retry-After`; the UI shows the wait time and disables Send.
- **Abort:** Stop (or closing the tab) aborts the browser request. The route then aborts the SDK call, and the loop stops without running further tools. Per the SDK docs, aborting is client-side only: Google may still finish, and bill, a request already in progress.
- **Safety of output:** model text is rendered with a tiny markdown subset (bold, lists, line breaks) as React text nodes; no HTML is ever injected. Errors shown to users are generic, and the server logs only the HTTP status, never the key or provider messages.
- **Verification status:** no `GEMINI_API_KEY` was available, so **the assistant has never run against the real Gemini model.**
  - Unit tests drive the whole loop through the real SDK with Google's HTTP layer mocked.
  - The browser tests ran the production build with the real route, real tools and live Open-Meteo data, but with `GEMINI_BASE_URL` pointed at a local scripted mock of the Gemini streaming API. Its answers were built from the real tool results it received.
  - Model behaviour (tool choice, wording, refusing off-topic requests, resisting injection) is therefore untested with the real model.
  - The tool layer itself was run live against Open-Meteo for Delhi, London, Mumbai and Springfield.
