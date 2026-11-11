# Phase 8 report: verification, polish, submission readiness

Run on 11 Nov 2026 against the production build (`next build && next start`) with live data: Open-Meteo, plus the real WAQI token and Gemini key from `.env.local`. No new features. Headless Chrome 157 was driven over the DevTools protocol. Scripts that are worth keeping are in `scripts/`; one-off drivers stayed outside the repository.

## Summary

| Area | Result |
| --- | --- |
| Clean install → gate | `rm -rf node_modules .next && npm ci`, then typecheck ✔, lint ✔, **270/270 tests** (75 suites) ✔, production build ✔ |
| `npm audit` | **0 vulnerabilities** (was 8 moderate, all in the dev-only lint toolchain; fixed with a scoped `overrides`) |
| Offline / service worker / shared links | All Phase 7b checks pass again on the final build (details below) |
| Accessibility (axe-core) | 12 routes × light/dark × desktop/mobile = 48 audits: **46 fully clean**. The only finding is `target-size` for overlapping map pins at desktop width (WCAG *Essential* exception, see below). No moderate or minor issues |
| Keyboard | Visible focus on every stop of 7 pages, no traps; four focus bugs found and fixed |
| Lighthouse (mobile) | Accessibility, Best Practices and SEO **100** on home and the city page. Performance: home **85 / 91** (two runs), city **81 / 82**, map **56** (details below) |
| PWA audit (Lighthouse 11) | Lighthouse 11.7.1 PWA category **100%**: installable manifest, splash screen, themed omnibox, content width, viewport and maskable icon all pass (the other 3 items are manual checks) |
| JS per route | Overview, home, alerts, assistant, about: **237–268 KB**, no chart library. Leaflet only on `/map` |
| Open-Meteo requests per view (cold server) | Home **6**, city page **3**, map **1** (+1 WAQI) |
| CSP | Enforced; **0 violations** on every route, offline, during export and the assistant |
| Click-through, 2 cities × every tab + every route | **23/23 views passed**; one console entry (the expected 404 log on the 404 page) |

## Step 1: fresh production verification

Clean install, typecheck, lint, 226 tests (at the start of the phase) and build all passed. Then, in headless Chrome against `next start` (re-run on the final build, cache version `final1`):

- **Service worker** registered (`/sw.js?v=final1`, active, controlling the page). Caches `airiq-pages-final1` (11 entries), `airiq-static-final1` (39), `airiq-api-final1` (8).
- **Offline** (server stopped and DevTools offline emulation, `navigator.onLine === false`):
  - The Delhi page shell loaded with the label **"Offline: showing data from 16:15, not live"**. 16:15 is the stored `X-AirIQ-Cached-At` (10:45:55Z) converted to Asia/Kolkata, so they match.
  - The same label appeared on the forecast tab, compare (3 labels), the report (inside the exported area) and the map (103 markers).
  - The US/EU toggle works offline. The History tab, never opened online, says "isn't available offline yet". An uncached route shows the offline page.
- **Assistant offline:** "The assistant needs a connection."; send and textarea disabled.
- **Alerts on stale data:** a rule set to fire on any reading recorded **nothing** offline (no events, no state). Once fresh data arrived it fired once ("Delhi: US AQI 206 (above 1)") through `ServiceWorkerRegistration.showNotification`, with the city URL.
- **Back online:** the "Back online. Refreshing data…" toast appeared, and the stale labels were gone after revalidation.
- **New deploy:** registering `v=final2` left only `airiq-*-final2` caches.
- **Shared link** `?scale=eu&profile=respiratory`:
  - The view uses EU and the Asthma profile; saved settings stay "us"/"general", including after a reload.
  - A plain URL afterwards uses the saved settings.
  - "Save as my settings" (pressed with Enter) saved "eu"/"respiratory" and removed the parameters from the URL.
- **Install:** Chrome's `Page.getInstallabilityErrors` returned `[]`, and the manifest has no parse errors. Icons decode at 192×192, 512×512 and 512×512 maskable. Headless Chrome fired a real `beforeinstallprompt`, so the Install button appeared, and it hid after `appinstalled`.
- **Console:** apart from network-failure logs while deliberately offline, the only entry is the known recoverable React #418 hydration warning when an offline tab URL that was never opened online is served the page saved for another tab (documented in Phase 7b).

## Step 2: accessibility

**axe-core 4.14** (`scripts/a11y-audit.mjs`, WCAG 2.0/2.1/2.2 A and AA plus best practices) ran on 12 routes: home; a city page with each of its 5 tabs; map; compare; alerts; assistant; report; about. Each route was checked in light and dark mode at 1280 px and 390 px, so 48 audits.

| | First run | Final build |
| --- | --- | --- |
| Clean audits | 32 / 48 | **46 / 48** |
| `color-contrast` (serious) | home, forecast, history (all themes and widths) | none |
| `label-content-name-mismatch` (serious) | home city cards | none |
| `target-size` (serious) | map, every theme and width (badges 22 px, plus overlap) | map at desktop width only, overlapping pins |
| Moderate / minor | none | none |

**Fixed (all serious, none critical):**
- **Colour contrast:**
  - White on EPA "Unhealthy" `#ff0000` was 4.0:1, and white on EEA "Poor" `#ff5050` 3.2:1; both now use `#1a0000` (5.0:1, 6.2:1).
  - Dark-theme danger badges were white on `#f97066` (2.8:1); they now use the new `--danger-contrast` token.
  - Official background colours and patterns are unchanged.
  - `lib/__tests__/contrast.test.ts` checks all 12 category pairs and every text and theme token at 4.5:1 (focus ring 3:1), in both themes.
- **Label in name:** home city cards used an `aria-label` that dropped visible text. The visible text is now the name, with a visually hidden scale label.
- **Target size:** map grid badges were raised from 22 px to 24 px.

**Remaining finding, with decision:** `target-size` on the map at desktop width, for station markers that **overlap** in dense networks (82 WAQI stations around Delhi). WCAG 2.2's Understanding document for 2.5.8 treats map pins under the *Essential* exception, because their position is the information. The alternatives it asks for exist:
- zooming in separates the pins;
- every place is reachable through search and its city page;
- every marker is keyboard-focusable.

No moderate or minor issues were reported on any page.

**Keyboard pass** (real key events), all fixed and re-verified:

| Flow | Before | After |
| --- | --- | --- |
| Skip link | Scrolled, but focus stayed on the link | Focus moves into `<main>` |
| Search combobox | ↓ / Enter / Escape and `aria-activedescendant` work | Unchanged |
| City tabs | Arrows, Home and End move and select; URL updates | Unchanged |
| Ask AirIQ sheet | Focus trapped (25 Tabs and Shift+Tab stay inside), Escape closes, focus returns to the trigger | Unchanged |
| Alert bell popover | Escape closes, focus returns to the bell | Unchanged |
| Alert form | Focus lost to `<body>` after picking a city | Focus on "Change" |
| Compare add / remove | Focus lost to `<body>` | Focus stays in the city picker |
| Map marker popup | Enter opened it, but Escape did nothing and the popup was far away in tab order | The popup takes focus; Escape closes it and focus returns to the marker |

Visible focus was confirmed on every Tab stop of home, city, compare, alerts, assistant, about and map, with no traps.

**Motion and colour scheme:** CSS already disabled animations and transitions under `prefers-reduced-motion`. Leaflet's JavaScript fly-to, zoom and fade animations now also respect it, and charts never animate. The theme follows `prefers-color-scheme` until the user picks one, and is applied before first paint.

## Step 3: performance

**Lighthouse 12.8.2, mobile profile** (simulated slow 4G and 4× CPU), against `next start` on this machine:

| Page | Performance | Accessibility | Best Practices | SEO | Observed LCP (real, unthrottled) | Simulated LCP | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home (start of phase) | 93 | 96 | 100 | 100 | 0.2 s | 3.2 s | 40 ms |
| **Home (final, 2 runs)** | **85 / 91** | **100** | **100** | **100** | 0.26–0.34 s | 3.1–3.3 s | 190–340 ms |
| City (start of phase) | 85 | 100 | 100 | 90 | 1.2 s | 4.2 s | 100 ms |
| **City (final, 2 runs)** | **81 / 82** | **100** | **100** | **100** | 0.35–0.40 s | 4.6–4.7 s | 140–180 ms |
| Map (start of phase) | 51 | 100 | 96 | 100 | n/a | 4.9 s | 3,660 ms |
| **Map (final)** | **56** | **100** | **96** | **100** | 0.54 s | 4.9 s | 1,440 ms |

**Met:** Accessibility, Best Practices and SEO of 90+ on home and the city page (all 100). Home Performance varies between runs, 85–91, with the variation coming from Total Blocking Time.

**Not met: city-page Performance (81–82).** The cause is architectural, and the cheap fixes were tried.
- The largest element is the verdict sentence, which needs the live reading. AirIQ fetches it in the browser after the JS starts, never in the HTML. That keeps every number fresh, and it is what lets the service worker label offline data. If the HTML carried readings, an offline copy of the page would show old numbers without a label.
- Lighthouse's simulation chains HTML → JS → `/api/air` → render at slow-4G speed (4.6 s). The real unthrottled LCP on this machine was 0.35–0.40 s.
- **Tried: preloading `/api/air` from the HTML.** Reverted, because Chrome fetched it twice: the data layer uses `cache: "no-store"` (needed so old data can only arrive through the labelled service-worker path), and such requests don't reuse a preload.
- **Tried: gzip for API JSON.** Reverted (see Step 4). On a host that compresses JSON (Vercel, nginx), the city page's 137 KB 7-day history would shrink to about 17 KB (measured with curl), which should help the score.
- Server-rendering the reading was not done: it is a feature-level change to the offline labelling, out of scope for a no-new-features phase.

**Map (56)** is outside the 90 target. It draws 45 grid badges, up to 80+ station markers (2,250 DOM nodes) and a canvas heatmap interpolated on the main thread. TBT fell from 3.7 s to 1.4 s this phase, but moving the IDW heatmap into a Web Worker or clustering markers would be new feature work. Its Best Practices 96 is Esri tile images served larger than they are displayed (`image-size-responsive`), which AirIQ doesn't control.

**Fixed this phase for performance:**
- the Recharts chunk no longer loads on every page;
- no wasted prefetch renders;
- one shared server cache;
- the unused font is gone;
- the CSP eval probe is gone;
- 24 px map badges, and 12 px station labels (were 11 px; a Lighthouse legibility finding).

**JS per route** (mobile, cold load, transferred, including idle-time prefetches; service worker and browser cache bypassed):

| Route | JS | Heavy libraries loaded |
| --- | --- | --- |
| `/` | 237 KB | none |
| `/city/…` (Overview) | 268 KB | none |
| `/city/…?tab=forecast` | 396 KB | Recharts |
| `/map` | 296 KB | Leaflet |
| `/compare` | 355 KB | Recharts |
| `/city/…/report` | 377 KB | Recharts (jsPDF and html-to-image only when exporting) |
| `/alerts`, `/assistant`, `/about` | 237 KB | none |

Before the fix, Next's prefetch of `/compare` and the report pulled the 110 KB Recharts chunk onto **every** page (it showed up as fully unused JS on Overview). The compare and report charts are now lazy-loaded.

**Upstream requests** (a second server instance on a cold cache, with outgoing `fetch` calls logged):

| View | Before | After | Calls |
| --- | --- | --- | --- |
| Home | 15 | **6** | one `/api/air` per popular-city card |
| City page (Overview) | 4 | **3** | geocoding (place name), current air, 14-day history (cigarette card) |
| Map (Delhi, z9) | 2 | 2 | one batched grid call (45 points), one WAQI bounds call |

Each SWR key was requested once per page view, so there were no duplicate client calls.
- **Home** was cut from 15 to 6 by switching off prefetch on dynamic city links. Each prefetch rendered a city page on the server, which spent a geocoding call and an air-quality call.
- **City page** was cut from 4 to 3 by sharing the server cache between pages and route handlers. The page's metadata and `/api/air` were fetching the same URL twice because the cache was bundled per module.

**Other fixes:** the unused Geist sans font is no longer downloaded (it was preloaded but never applied). The floating "Ask AirIQ" button no longer covers the footer.

## Step 4: robustness

- **`app/error.tsx`:** "Try again" (Next 16 `retry`) and "Go to the dashboard"; shows only the error digest.
- **`app/global-error.tsx`:** its own document and styles.
- **`app/not-found.tsx`:** explains the link format and offers search and the map.
- **Invalid city slugs** (`/city/not-a-place`, `/city/delhi-999-999`) return a **real 404**. A `loading.tsx` for city pages was tried and removed, because streaming fixed the status at 200.
- **`lib/env.ts` (Zod) + `instrumentation.ts`:** every variable is optional. Empty values count as unset, and invalid ones are ignored with a warning naming only the variable. Startup log: `[airiq] Air quality, weather and geocoding: on | Ground stations on the map: on | AI assistant: on`. `/about` shows the same status. 6 unit tests, including that no secret can appear in any message.
- **Cleanup:**
  - removed the unused `components/ComingSoon.tsx`;
  - no `console.log` anywhere (two `console.error` calls for server errors, plus the startup summary);
  - every runtime dependency is used;
  - `axe-core` was added as a dev dependency.
- **`npm audit`: 0 vulnerabilities.** The 8 moderate findings were one minimatch ReDoS advisory, reached only through the dev-only lint toolchain. npm's fix would have downgraded `eslint-config-next` to 15.x. Instead, `overrides` pins `@typescript-eslint/typescript-estree` → `minimatch@^11.0.7`; lint was re-checked and still reports TypeScript problems.
- **Security headers:**
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`;
  - `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()`;
  - an **enforced** Content-Security-Policy (see ARCHITECTURE.md).
- **CSP testing:** tested in the browser on every route, offline with the service worker, with 60 Esri tiles loading, the OG image route, PNG and PDF report export, and the assistant. 0 `securitypolicyviolation` events. Lighthouse first flagged a CSP issue: Zod 4's caught `new Function` probe. All Zod imports now go through `lib/zod.ts` (`jitless`), and a lint rule enforces it.
- **CI:** `.github/workflows/ci.yml` runs npm ci, typecheck, lint, tests and build on push and pull request (Node 22, no keys). It has not run on GitHub yet; nothing is pushed.

Gzip for API JSON was tried and reverted: `next start` strips `Content-Encoding` from route-handler responses but sends the compressed bytes, which broke every API call in the browser while the unit tests passed.

## Step 5: attribution and legal

- `/about` (linked in every footer) covers:
  - what AirIQ is, and the disclaimer "General information, not medical advice";
  - 8 sources, each with how AirIQ uses it and its terms;
  - live feature status;
  - methodology: AQI, the trend model and its backtest limits, correlations, health rules;
  - known limitations.
- The terms were read on the providers' own pages and are cited in the README:
  - Open-Meteo: licence (CC BY 4.0, link required) and terms (free API non-commercial, under 10,000 calls a day).
  - CAMS licence notice; WAQI API terms; OpenAQ terms.
  - Esri attribution requirements, plus the tile service's own `copyrightText`.
  - BigDataCloud terms: client side only, with the device's own location.
  - Berkeley Earth.
- **Compliance fixes:**
  - The map's attribution now has "Powered by Esri" and Esri's exact data credits.
  - Map points are **no longer** sent to BigDataCloud. Its free client endpoint may only be used with the device's current location.
- The footer on every page carries the attribution line. The full-screen map shows it in its attribution bar instead, with a "Sources" link to /about.

## Step 6: documentation

- **README:** summary; 16 screenshots; challenge-item table; extras; Mermaid architecture; tech stack; structure; 4-command setup; environment table; API routes; testing; deployment; sources with citations; limitations; the trend model; decisions for every phase.
- **`docs/screenshots/`:** 16 PNGs from the production build with live data:
  - home, dashboard, map with heatmap, forecast, history calendar, health, weather, compare, assistant (a real Gemini answer), alerts (a real rule fired by live data), report, about, mobile;
  - dark versions of home, the dashboard and the map.
  They contain no keys or personal data: no geolocation was used, and the alert rule and assistant question are generic.
- **`docs/DEMO.md`:** a 3-minute script with click paths and talking points, plus:
  - 4 checked demo cities: Delhi (206), Wellington (20, UTC+13), Kathmandu (UTC+05:45), Springfield (3 US matches);
  - what to do if an API is slow or rate-limited;
  - a pre-demo checklist.
- **`docs/ARCHITECTURE.md`:** data flow, caching and Zod, client data layer, AQI logic, model, alert engine, service worker, assistant tool loop and grounding guard, security headers.

## Step 7: final acceptance

From a clean install (`rm -rf node_modules .next && npm ci`): typecheck ✔, lint ✔, **270 tests, 75 suites, 0 failures**, build ✔ (21 routes).

**Click-through on `next start`:**
- Delhi and Wellington × overview, forecast, history (30 days), health, weather and report (including PNG and PDF export).
- Plus home, map (AQI, and PM2.5 around Wellington), compare, alerts, assistant (`configured: true`, `gemini-3.6-flash`), about, offline and 404.
- Plus a dark mobile city page and map.

Result: **23/23 views ready, no error banners, no CSP violations, no horizontal overflow on mobile.** The OG image is a 57 KB PNG.

**Console:**
- One entry in the click-through: the expected "Failed to load resource: 404" on the 404 page.
- In the offline run, the network-failure logs Chrome prints while offline and the known #418 warning.
- No other warnings.

### Challenge items: where they live and the evidence

| Item | Where | Evidence on live data (11 Nov 2026) |
| --- | --- | --- |
| Real-time AQI dashboard | `/`, `/city/[slug]` | Delhi US AQI 206 "Very Unhealthy", Wellington 20 "Good". Six home cards live (Delhi 206, Mumbai 189, London 61, New York 50, Beijing 226, Los Angeles 62). Values match `/api/air` and Open-Meteo `us_aqi` |
| Interactive map | `/map` | 103 markers around Delhi: the 45-point CAMS grid and WAQI stations (82 shown). Esri tiles load under the CSP. Popups open by click and keyboard. Layers switch |
| Historical tracker | History tab | 30 days for Delhi: best day 84 (30 Oct), worst 227 (5 Nov), average 172 over 713 of 720 hours, +15% vs the previous 30 days. Calendar and hour-of-day heatmaps render |
| AQI forecasting | Forecast tab | Official CAMS forecast plus the AirIQ model. The backtest panel reads "trained on 624 h, predicted the last 48 h (48 comparable hours)" for both cities |
| AI assistant | `/assistant`, Ask AirIQ | Real Gemini (`gemini-3.6-flash`) answered "Is it safe to run outdoors today?" for Delhi with 3 tool calls. Its figures (US AQI 206, PM2.5 77.8 µg/m³, EU 97, O₃ 177) match the dashboard at the same time |
| Smart alerts | `/alerts` | A "Delhi US AQI above 150" rule fired from live data (206) with "Check now". A stale-data run recorded nothing. A notification went through the service worker with the city URL |
| Heatmaps and analytics | Map heatmap, History heatmaps, Weather tab, Compare | IDW heatmap over the grid; calendar and weekday × hour heatmaps; weather correlations, scatter and wind rose render for both cities; compare summary "Wellington has been cleaner than Delhi on all of the 6 days with data for both in the last 7 days" |

### Not verified

- A click on a **real OS notification**. Headless Chrome shows none; the test recorded the `showNotification` call and its URL, and the click handler's URL rule is unit-tested.
- The browser's **install dialog** and the installed app window. The button was driven by Chrome's real `beforeinstallprompt` and a synthetic `appinstalled`.
- **Real mobile devices** (iOS Safari, Android Chrome). Only emulated 390 px viewports were tested.
- **Production scale:**
  - multiple server instances, where the in-memory assistant rate limiter and cache are per instance;
  - upstream quotas under real traffic;
  - CDN behaviour.
- **The CI workflow on GitHub** (written, not yet run), and a real deployment (Vercel or another host).
- **Screen readers.** The accessibility checks were axe-core plus a scripted keyboard pass; no NVDA, JAWS or VoiceOver session.
