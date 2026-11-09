# AirIQ: Real-Time Air Quality Intelligence

Built for the **BREATHE BETTER** hackathon. AirIQ shows live AQI, pollution maps, history, forecasts, alerts and an AI assistant, using only authentic public air-quality data.

> 🚧 Work in progress. Phase 1 (scaffold, AQI engine, Open-Meteo client, geocode/air routes) is complete.

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

All upstream calls are validated with Zod and normalized to the types in `types/air.ts`. Failures return `{ error, detail }` with a 4xx/5xx status. The app never substitutes made-up values.

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
