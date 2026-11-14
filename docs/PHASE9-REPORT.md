# Phase 9 report: station-first headline, extreme values, India NAQI

Run on 14 Nov 2026 (about 21:45–22:40 IST) against the production build (`next build && next start`) with live data: Open-Meteo, the WAQI token and Gemini from `.env.local`. No OpenAQ key was set.

## Step 1: the "500+ in Delhi" claim

Checked with WAQI `/map/bounds/` for 28.2–29.3 N, 76.6–77.8 E at 21:48 IST. Full output: [PHASE9-station-check.txt](PHASE9-station-check.txt).

| | Value |
| --- | --- |
| Stations with a numeric AQI | 67 (one more without a value) |
| Maximum | **440**, Anand Vihar (11.2 km from Delhi's centre, observed 21:00 IST) |
| Median | 215 |
| Above 300 / above 500 | 9 / **0** |
| Fresh (≤ 3 h) within 15 km of Delhi's centre | 26, median 231 |
| Open-Meteo model at Delhi's centre / Sonipat | US AQI 177 / 150 |

**No station was above 500 at the time of the check.** The claim was not supported by WAQI's live data then. The extreme-value handling was built anyway and verified with injected data (below).

Most of the top stations fall in the same CAMS grid cell, so the model gives them all 177; this is the smoothing the station-first headline addresses.

## Delhi and Sonipat now (22:38 IST, Auto, for comparison with other apps)

| | Delhi (28.61 N, 77.21 E) | Sonipat (29.00 N, 77.02 E) |
| --- | --- | --- |
| Headline | **US AQI 248, Very Unhealthy** | **US AQI 145, Unhealthy for Sensitive Groups** |
| Source | Median of 18 fresh stations within 15 km | Model (Open-Meteo, CAMS) |
| Station count (listed / fresh ≤ 3 h) | 25 / 18 | 1 / 0 |
| Median | 248 | n/a |
| Highest station | 400 at Delhi Institute of Tool Engineering, Wazirpur (11 km) | n/a |
| Nearest station | 221 at Major Dhyan Chand National Stadium (2.7 km) | Murthal 187 (5.1 km), observed 19:00 IST, **3.5 h old, not used** |
| Latest observation | 22:00 IST | model hour 22:30 IST |
| Model US AQI | 174 (stations read 43% higher) | 145 |
| India NAQI | **188, Moderately polluted, model-based** | **87, Satisfactory, model-based** |
| Note shown | "Stations and the model differ by 43%…", episode banner | "No nearby station data: no station within 15 km has reported in the last 3 hours." |

NAQI is model-based for both because no OpenAQ key is set, and WAQI publishes US AQI only (never converted). In Delhi the NAQI (188) is lower than the stations' US AQI (248) because it comes from the model's smoothed concentrations; the episode banner still fires from the stations, and the UI says so.

## Verification

### Gate

From the final tree: typecheck ✔, lint ✔, **349 unit tests in 91 suites, 0 failures** (was 270), production build ✔ (23 routes).

New suites: `naqi.test.ts` (25), `headline-source.test.ts` (21), `phase9.test.ts` (22), plus updates to aqi, alerts, assistant, contrast, map, share and view-prefs tests. They cover:
- station selection: ≥ 3 stations median, single station within 10 km, single station too far, too old, none, token missing, feed error, the modes, all three scales;
- the 25% divergence note (above, at and below the threshold, both directions);
- NAQI sub-indices at every breakpoint edge for all 7 pollutants, the CPCB worked example, gaps between printed ranges, Severe and beyond, the 16/24 and 6/8 hour rules, the 3-pollutant/PM rule, CO unit conversion, trailing windows;
- station-based NAQI (OpenAQ) unit conversion and alignment, with fixtures;
- beyond-index values (499, 500, 501, 650; PM2.5 above 500.4 µg/m³) in categories, formatting, gauge position, chart axes, heatmap colours and alerts;
- health rules: a headline for every scale × audience × rank; beyond-index gets exactly the Hazardous guidance for every profile; NAQI Severe; episode actions; NAQI default thresholds;
- heatmap blending in all modes; the assistant with stations, beyond-index flags, a failing feed and the numeric guard.

### NAQI against CPCB and an independent script

- CPCB's worked example (About_AQI.pdf): PM2.5 31 → 51, 45 → 75, 60 → 100. Unit-tested, all match.
- A separate script with its own CPCB table (no AirIQ code), using live Open-Meteo concentrations at 21:30 IST:

| | Script | AirIQ `/api/air` | Match |
| --- | --- | --- | --- |
| Sonipat | 89 (PM2.5 89, PM10 77, O₃ 83, NO₂ 22, SO₂ 19, CO 17) | 89, same sub-indices | **Yes** |
| Delhi | 199 (PM2.5 199, PM10 112, CO 76, O₃ 67, NO₂ 60, SO₂ 45) | 199, same sub-indices | **Yes** |

### Headless Chrome (production build, live data)

**27 city views** (Delhi, Sonipat, London × Auto / Nearest station / Model only × US / EU / NAQI, opened through shared-link parameters), all ready, no "NaN":

| City | Auto, US | Nearest, US | Model, US | EU (any mode) | NAQI (any mode) |
| --- | --- | --- | --- | --- | --- |
| Delhi | 248, median of 18 · highest 400 | 221, Major Dhyan Chand Stadium (3 km) | 177, "Model only" | 65, model + note | 199, model-based + note |
| Sonipat | 150, model, "No nearby station data" | 150, model, same note | 150 | 61 | 89 |
| London (clean) | 26, median of 17 · highest 68 | 46, "London" (<1 km) | 72 | 51 | 72 |

- **Divergence note** shown for Delhi (40%) and London (stations 26 vs model 72), not for Sonipat.
- **Episode banner** on Delhi in every mode and scale: from the headline on US Auto/Nearest, and from the stations (US 248) on EU, NAQI and US Model only (fixed during the run: Model only on US first showed no banner).
- **Stations near you**: 25 rows nearest first (2.5, 2.7, 2.8, 3.8 km); AQI sort descending 404, 400, 370, 322 (`aria-sort="descending"`) then ascending; stale rows marked "not used: older than 3 h"; "Show on map" link.
- **Map** (Delhi, z10): 112 markers, 67 stations. Blended: "24 fresh stations drive the surface near them; the model grid fills areas more than 15 km from any station." Stations only: "24 fresh ground stations only". Model only: "model grid". NAQI scale: "Station values are US AQI and are not blended into this layer"; grid badges in NAQI ("India NAQI 210, Poor"). Station popup: name, WAQI, US AQI, **main pollutant PM2.5** (from `/api/station`), "This feed gives index values, not concentrations", observation time and age (flagged "older than 3 h"), **model at this point: US AQI 174 (2 km)**.
- **Compare**: Delhi 248 "Stations (median of 18) · model 177", Sonipat 150 "Model (Open-Meteo)", London 26 "Stations (median of 17) · model 72"; ranking shows each source.
- **Shared link** `?source=model`: notice "Viewing with data source: Model only from a shared link", nothing saved; "Save as my settings" saved `"model"` and removed the parameter.
- **Forced beyond-index** (test-only CDP interception of `/api/stations` and `/api/history`; the app was not changed):
  - gauge **"500+"**, pointer pinned (`data-beyond="true"`), "Beyond scale: Beyond index (computed 659)", subtitle "highest 500+ at CRRI Mathura Road", category "Beyond index", Hazardous-level advice, banner "Pollution episode: Beyond index";
  - history chart axis extended to about 1,000 with the beyond band; best/worst day "500+ Beyond index"; no NaN;
  - map: 54 station markers labelled "500+" with the beyond style;
  - alert (rule US AQI > 300): "Delhi: US AQI 500+ (above 300)… 500+ (computed 659, beyond the 500 top of the index)… source: Stations (median of 25)".
- **Blocked `/api/stations`**: gauge falls back to the model (177) with "No nearby station data: the station feed is unavailable right now."; the stations panel says the same.
- **Dark mode, 390 px mobile**: city page and map render, no horizontal overflow.
- **Assistant (real Gemini)**, Delhi, "Is it safe to run outdoors today?": "No… US AQI 248 (Very Unhealthy), based on the median of 18 stations within 15 km… The model estimates a lower US AQI of 174, because the model smooths out local pollution… Nearby ground stations read 43% higher than the model, meaning the model forecast likely underestimates…" Three tool calls; no unmatched-figure warning.
- **Console**: one entry across all runs, the deliberately blocked `/api/stations` request (`ERR_BLOCKED_BY_CLIENT`). No exceptions.

Screenshots: [docs/screenshots/phase9/](screenshots/phase9/).

## Not verified

- **CPCB's official NAQI bulletin was not compared directly.** cpcb.nic.in did not respond from this machine; the method was taken from archived copies of CPCB's own documents and checked against their worked example and an independent script.
- **Station-based NAQI with live OpenAQ data**: no `OPENAQ_API_KEY` was set, so it is covered by unit tests with fixtures only.
- **A real station reading above 500**: none existed during testing; beyond-index behaviour was verified with injected data.
- **The exact CPCB colour hex values**: AirIQ uses CPCB's green → dark-red sequence with its own hex values (chosen for WCAG AA).
- Real mobile devices, screen readers, and behaviour at production scale (WAQI quotas with many users, multi-instance caching) remain unverified, as in Phase 8.
