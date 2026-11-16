import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { getEnvReport } from "@/lib/env";

export const metadata: Metadata = {
  title: "About, sources and methods",
  description:
    "What AirIQ is, where its data comes from and under which terms, how the headline, AQI, India NAQI, trend model and correlations are calculated, why apps show different numbers, and the known limitations.",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="font-medium underline underline-offset-2" rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
}

interface Source {
  name: string;
  used: string;
  terms: ReactNode;
}

export default async function AboutPage() {
  // Read the environment at request time, so the feature list reflects the running server.
  await connection();
  const { features } = getEnvReport();
  const year = new Date().getUTCFullYear();

  const sources: Source[] = [
    {
      name: "Open-Meteo Air Quality API",
      used: "Current, hourly, historical (up to 92 days) and forecast pollutant concentrations, and the US and European AQI values. Also the map grid.",
      terms: (
        <>
          Data under <Ext href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Ext>, with a link to Open-Meteo wherever its data are shown (
          <Ext href="https://open-meteo.com/en/licence">licence</Ext>). The free API is for <strong>non-commercial use only</strong>, under 10,000 calls a day (
          <Ext href="https://open-meteo.com/en/terms">terms</Ext>). A commercial deployment needs an Open-Meteo API plan.
        </>
      ),
    },
    {
      name: "Copernicus Atmosphere Monitoring Service (CAMS)",
      used: "The model behind Open-Meteo's air-quality data: CAMS European (about 11 km) and CAMS global (about 45 km) forecasts.",
      terms: (
        <>
          Generated using Copernicus Atmosphere Monitoring Service information {year}. AirIQ also derives values from it (averages, the trend model,
          interpolated heatmaps), so those views contain modified Copernicus Atmosphere Monitoring Service information {year}. Neither the European
          Commission nor ECMWF is responsible for any use of this information (<Ext href="https://apps.ecmwf.int/datasets/licences/cams">CAMS licence</Ext>).
          The European forecast is produced by the CAMS regional ensemble (METEO FRANCE, Ineris and partner institutes) (
          <Ext href="https://open-meteo.com/en/docs/air-quality-api">Open-Meteo air quality docs</Ext>).
        </>
      ),
    },
    {
      name: "Open-Meteo Weather and Geocoding APIs",
      used: "Hourly weather for the weather analysis, and city search.",
      terms: (
        <>
          Weather from national weather services&rsquo; models combined by Open-Meteo, CC BY 4.0 (
          <Ext href="https://open-meteo.com/en/docs">weather docs</Ext>). Location data based on <Ext href="https://www.geonames.org/">GeoNames</Ext> (
          <Ext href="https://open-meteo.com/en/docs/geocoding-api">geocoding docs</Ext>).
        </>
      ),
    },
    {
      name: "World Air Quality Index Project (WAQI)",
      used: "Ground-station readings (US AQI as reported) when a WAQI token is configured: the station-first headline (median of nearby stations), the Stations near you list, map markers and the blended heatmap.",
      terms: (
        <>
          Attribution to the World Air Quality Index Project and the originating EPA is mandatory. Each station popup names WAQI and links to the
          station&rsquo;s aqicn.org page, which names the originating agency. The data may not be sold, used in paid applications, or redistributed as cached
          or archived data (<Ext href="https://aqicn.org/api/">WAQI API terms</Ext>). AirIQ only shows it; short-lived caches serve the same viewer.
        </>
      ),
    },
    {
      name: "OpenAQ",
      used: "Optional backup source for ground-station PM2.5, and the station-based India NAQI (from a station's own hourly concentrations), when an OpenAQ key is configured.",
      terms: (
        <>
          Attribution to OpenAQ is required, and users must acknowledge the original data providers when they require it (
          <Ext href="https://docs.openaq.org/about/terms">OpenAQ terms</Ext>). Station popups name OpenAQ and link to the location on OpenAQ Explorer.
        </>
      ),
    },
    {
      name: "Central Pollution Control Board (CPCB), India",
      used: "The India National Air Quality Index method: breakpoints, averaging periods, minimum-data rules and health statements. AirIQ computes NAQI itself.",
      terms: (
        <>
          Breakpoint table, averaging periods and the worked example (PM2.5 31 → 51, 45 → 75, 60 → 100):{" "}
          <Ext href="https://web.archive.org/web/20160804011654/http://cpcb.nic.in:80/About_AQI.pdf">CPCB, About National Air Quality Index</Ext>. Minimum-data rules (at least
          three pollutants including PM2.5 or PM10; at least 16 hours for a 24-hour sub-index) and health statements (Table 3.12):{" "}
          <Ext href="https://web.archive.org/web/20160417204306/http://www.cpcb.nic.in/FINAL-REPORT_AQI_.pdf">CPCB, National Air Quality Index report (2014)</Ext>. Both are archived copies of
          cpcb.nic.in, which did not respond when checked. AirIQ&rsquo;s NAQI may differ from CPCB&rsquo;s official bulletin.
        </>
      ),
    },
    {
      name: "Esri basemap tiles",
      used: "The light and dark gray canvas basemaps and labels on the map.",
      terms: (
        <>
          &ldquo;Powered by Esri&rdquo; and the data credits (Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community) are shown on the
          map (<Ext href="https://developers.arcgis.com/documentation/esri-and-data-attribution/">Esri attribution requirements</Ext>). Tiles are not stored or
          redistributed. A production deployment should review Esri&rsquo;s terms of use.
        </>
      ),
    },
    {
      name: "BigDataCloud reverse geocoding",
      used: "A place name for “Use my location”.",
      terms: (
        <>
          The free client-side endpoint is called from your browser, only with your device&rsquo;s current location, as its terms require (
          <Ext href="https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api">BigDataCloud terms</Ext>). Map points are not sent to it.
        </>
      ),
    },
    {
      name: "Berkeley Earth",
      used: "The cigarette-equivalent rule of thumb.",
      terms: (
        <>
          Breathing 22 µg/m³ of PM2.5 for a day is roughly equivalent to smoking one cigarette (
          <Ext href="https://berkeleyearth.org/air-pollution-and-cigarette-equivalence/">Air Pollution and Cigarette Equivalence</Ext>). It is a rough
          comparison of health risk to help people grasp the scale, not a statement that the two are chemically the same.
        </>
      ),
    },
  ];

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-10 py-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">About AirIQ</h1>
        <p className="text-lg text-muted">
          AirIQ shows live air quality for any place on Earth: the current AQI and pollutants, a pollution map, history, forecasts, health advice, alerts and an
          AI assistant. It uses public data only, and it says where every number comes from.
        </p>
        <p role="note" className="rounded-xl border border-border bg-surface p-4 text-sm">
          <strong>General information, not medical advice.</strong> If you have symptoms or a health condition, follow your doctor&rsquo;s advice. In an
          emergency, call your local emergency number.
        </p>
      </header>

      <Section id="about-sources" title="Data sources and attribution">
        <ul className="flex flex-col gap-4">
          {sources.map((s) => (
            <li key={s.name} className="rounded-xl border border-border bg-surface p-4">
              <h3 className="font-semibold">{s.name}</h3>
              <p className="mt-1 text-sm">
                <span className="text-muted">Used for: </span>
                {s.used}
              </p>
              <p className="mt-2 text-sm leading-relaxed">{s.terms}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Terms were checked on the providers&rsquo; own pages on 11 November 2026 (CPCB documents on 14 November 2026).</p>
      </Section>

      <Section id="about-features" title="Features on this server">
        <ul className="flex flex-col gap-2 text-sm" data-testid="feature-status">
          {features.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.enabled ? "bg-brand text-brand-contrast" : "border border-border text-muted"}`}>
                {f.enabled ? "On" : "Off"}
              </span>
              <span className="font-medium">{f.label}:</span>
              <span className="text-muted">{f.detail}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="about-methods" title="Methodology">
        <div className="flex flex-col gap-4 text-sm leading-relaxed">
          <div id="headline">
            <h3 className="font-semibold">How the headline number is chosen</h3>
            <p>
              With the data source on <strong>Auto</strong> (the default): when at least 3 ground stations within 15 km have reported in the last 3 hours, the
              headline is the <strong>median</strong> of their US AQI, and the highest station and the count are shown with it. Otherwise, if one fresh station is
              within 10 km, that station is the headline. Otherwise it is the model (Open-Meteo, CAMS). <strong>Nearest station</strong> uses the closest fresh
              station within 15 km; <strong>Model only</strong> always uses the model. The gauge always says which source it shows and when it was observed, and
              AirIQ never switches source silently. When stations and the model differ by more than 25%, both numbers are shown with a short explanation.
              Health advice, alerts, the assistant, compare and the report use the same headline. The forecast is always the model and is labelled as such.
            </p>
            <p className="mt-2">
              Station networks publish the US AQI only, so station values are never converted: the European AQI headline is always the model, and the India
              NAQI comes from concentrations (see below).
            </p>
            <p className="mt-2">
              <strong>Older station readings.</strong> A reading counts for the headline for 3 hours. When the nearest station within 10 km last reported 3 to 12
              hours ago, its reading is shown under the gauge as a separate, labelled line (&ldquo;Last reading at Murthal, Sonipat (5.1 km): 187, 18:00 IST
              (4.6 h ago)&rdquo;), with a note when it is more than 25% above the headline, because the model may then under-estimate current pollution.
              Readings older than 12 hours appear only in the &ldquo;Stations near you&rdquo; list, with their age.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">AQI</h3>
            <p>
              The model numbers are Open-Meteo&rsquo;s US AQI and European AQI, computed from CAMS concentrations. The US index uses the EPA breakpoints (May 2024
              revision, with 24-hour PM averages and 8-hour ozone); the European index uses the EEA bands on hourly values. The main pollutant is the one with the
              highest sub-index. AirIQ recomputes the US index itself as a visible cross-check. Every category has a colour, a pattern and a text label, so colour
              is never the only cue.
            </p>
            <p className="mt-2">
              <strong>Above the top of an index</strong>, AirIQ keeps the computed value instead of clipping it: the top band&rsquo;s line is extended (for
              example PM2.5 of 400 µg/m³ is US AQI 649). It is displayed as <strong>&ldquo;500+&rdquo;</strong> (&ldquo;100+&rdquo; on the European index, whose
              bands end at 100) with the computed number in the label, flagged &ldquo;Beyond index&rdquo; (US, with its own dark maroon zigzag category) or
              &ldquo;Severe, beyond index&rdquo; (NAQI). The gauge pointer is pinned at the end with a &ldquo;Beyond scale&rdquo; label, chart axes extend, and
              health advice uses the strongest (Hazardous / Severe) guidance.
            </p>
          </div>
          <div id="naqi">
            <h3 className="font-semibold">India NAQI (computed by AirIQ)</h3>
            <p>
              AirIQ follows CPCB&rsquo;s method: a sub-index I = (I<sub>HI</sub> − I<sub>LO</sub>) / (B<sub>HI</sub> − B<sub>LO</sub>) × (C − B<sub>LO</sub>) +
              I<sub>LO</sub> for each pollutant, from 24-hour means of PM10, PM2.5, NO₂, SO₂ and NH₃ and 8-hour means of CO (in mg/m³) and O₃; the overall NAQI is
              the highest sub-index. A 24-hour mean needs at least 16 hours of data (CPCB); AirIQ applies the same two-thirds rule to 8-hour means (6 of 8
              hours). The index needs at least three pollutants, one of them PM2.5 or PM10; otherwise AirIQ shows &ldquo;Not enough data&rdquo;. CPCB&rsquo;s
              Severe band is open-ended (&ldquo;250+&rdquo; for PM2.5): AirIQ continues the Very-poor slope, so Severe spans 401–500 over the same
              concentration width (PM2.5 251–380, PM10 431–510), and values above it are kept and shown as &ldquo;500+&rdquo;. CPCB lists the Very-poor and
              Severe ozone breakpoints as 1-hour values; AirIQ applies the table to the 8-hour mean. NH₃ is in the calculation but Open-Meteo does not provide it
              outside Europe. Sources:{" "}
              <Ext href="https://web.archive.org/web/20160804011654/http://cpcb.nic.in:80/About_AQI.pdf">About National Air Quality Index</Ext>,{" "}
              <Ext href="https://web.archive.org/web/20160417204306/http://www.cpcb.nic.in/FINAL-REPORT_AQI_.pdf">National Air Quality Index report</Ext>.
            </p>
            <p className="mt-2">
              <strong>From what.</strong> Where ground stations exist (and OpenAQ is configured), AirIQ computes NAQI from the stations&rsquo; own
              concentrations: OpenAQ republishes CPCB&rsquo;s real-time station data. For up to 15 stations within 15 km that reported in the last 3 hours
              (CPCB-sourced stations first), each station&rsquo;s NAQI uses the 24-hour means of its hourly PM2.5 and PM10 (at least 16 of 24 hours) and the
              latest hourly value of NO₂, SO₂, CO and O₃. CPCB averages the gases over 24 or 8 hours; AirIQ uses the latest hour for them to stay inside
              OpenAQ&rsquo;s free rate limit (in particle episodes, PM sets the index). The city figure is the <strong>median</strong> of the stations with
              enough data when there are at least 3, otherwise the nearest one. It is labelled &ldquo;India NAQI, computed by AirIQ from station concentrations
              (median of N stations)&rdquo;; per-station values are listed under &ldquo;Stations near you&rdquo; next to the same site&rsquo;s WAQI US AQI,
              for comparison only. Without stations nearby, NAQI is &ldquo;computed by AirIQ from model concentrations&rdquo; (Open-Meteo).
            </p>
            <p className="mt-2">
              NAQI uses 24-hour averages for particles, so it can read higher than the latest hourly station values (WAQI&rsquo;s US AQI in
              &ldquo;Stations near you&rdquo; is the latest hour). After a polluted morning, for example, the 24-hour mean stays high into the evening.
            </p>
            <p className="mt-2">
              <strong>Never a contradictory NAQI.</strong> The model&rsquo;s smoothed concentrations can give a far lower NAQI than the stations around it:
              on 14 Nov 2026 Delhi&rsquo;s stations read US AQI 248 (median of 18) while the model gave NAQI 188, &ldquo;Moderately polluted&rdquo;. So
              when stations drive the US headline but no station-based NAQI is available, AirIQ shows &ldquo;India NAQI from stations unavailable&rdquo; and
              gives the model value only as a secondary &ldquo;model estimate, likely lower than station readings here&rdquo;; health advice then uses the
              stations&rsquo; US AQI. An automatic check also warns whenever a model NAQI shown is more than one NAQI category below the category the
              stations&rsquo; US AQI implies (worked out through the PM2.5 concentration that US AQI corresponds to; used only to compare categories, never
              shown as a value).
            </p>
          </div>
          <div>
            <h3 className="font-semibold">AirIQ trend model</h3>
            <p>
              A damped Holt-Winters model with a 24-hour daily cycle, fitted to the last 28 days of hourly PM2.5 (on a log scale) and run 48 hours ahead. It is
              shown next to the official CAMS forecast, never instead of it. Each time it runs, it is backtested on the last 48 hours (held out from fitting)
              against two simple baselines: &ldquo;same as now&rdquo; and &ldquo;same hour yesterday&rdquo;. The forecast tab shows the current scores and says
              plainly when the model does not beat a baseline, which happens in some cities. One 48-hour backtest is a small sample: it shows recent skill, not
              a guarantee. The shaded 80% range comes from the model&rsquo;s past errors. With too little data the model is not shown.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Weather correlations</h3>
            <p>
              PM2.5 and each weather variable are paired on identical hours, averaged per local day (days with at least 18 paired hours), and compared with
              Spearman&rsquo;s rank correlation. Strength labels: below 0.2 weak, 0.2 to 0.5 moderate, above 0.5 strong. No significance tests are shown.
              Correlation is not causation: weather and pollution both follow seasons and weekly patterns.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Health advice</h3>
            <p>
              Advice is selected from a fixed table of rules based on the US EPA AirNow Air Quality Guide, the EEA index recommendations, CPCB&rsquo;s NAQI health
              statements, EPA guidance on wildfire smoke and air cleaners, and WHO 2021 guideline values. CPCB gives no activity-level advice, so on the NAQI
              scale AirIQ applies EPA&rsquo;s activity guidance for the category of the same severity, and says so next to each item. Nothing in it is generated
              by AI. When the headline is Very Unhealthy or worse (US 201+, NAQI Very poor or Severe), or nearby stations read US AQI 201+, a pollution-episode
              banner shows the most important actions from these rules.
            </p>
          </div>
        </div>
      </Section>

      <Section id="about-differences" title="Why AirIQ, Google and other apps can show different numbers">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Modelled vs measured.</strong> A model such as CAMS estimates the average over a grid cell of about 10–45 km and smooths out local hot spots;
            a ground station measures the air at one spot, often next to a busy road. In Delhi-NCR on 14 November 2026 the model said US AQI 177 while the
            median of 26 fresh stations within 15 km was 231 and the highest was 440.
          </li>
          <li>
            <strong>Different scales.</strong> The US EPA AQI, the European index and India&rsquo;s NAQI use different breakpoints and categories for the same
            air. 125 µg/m³ of PM2.5 is US AQI 200 (&ldquo;Unhealthy&rdquo;) but NAQI 304 (&ldquo;Very poor&rdquo;). Google shows a local index in many
            countries.
          </li>
          <li>
            <strong>Averaging periods.</strong> NAQI and the US index use 24-hour averages for particles; some apps show an instantaneous hourly value, which
            can be far higher (or lower) during a spike.
          </li>
          <li>
            <strong>Hourly unvalidated vs validated data.</strong> Real-time station feeds are raw hourly readings that CPCB and other agencies validate later.
            Official daily bulletins can differ from the live numbers.
          </li>
          <li>
            <strong>Coverage and delays.</strong> Stations report at different times (often 1–3 hours late) and some go offline; a single nearby station can
            dominate an app that uses &ldquo;nearest station&rdquo;.
          </li>
          <li>
            <strong>How AirIQ chooses.</strong> AirIQ prefers the median of fresh nearby stations, shows the model next to it, labels every number with its
            source and time, and never converts a station&rsquo;s US AQI into another index (see{" "}
            <a href="#headline" className="underline underline-offset-2">
              how the headline is chosen
            </a>
            ).
          </li>
        </ul>
      </Section>

      <Section id="about-limits" title="Known limitations">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Grid data is modelled, not measured.</strong> CAMS values are model estimates for cells of about 11 km (Europe) to 45 km (elsewhere). They
            smooth out local hot spots such as busy roads. The map heatmap is interpolated between grid points.
          </li>
          <li>
            <strong>Ground stations vary in coverage.</strong> They are optional, dense in some cities and absent in others. WAQI gives only an AQI per station
            (no concentrations), so it cannot feed the European index or NAQI. Readings older than 3 hours are not used for the headline (the map hides
            OpenAQ readings older than 6 hours).
          </li>
          <li>
            <strong>Alerts only run while AirIQ is open</strong> in a browser tab. There is no push service, so nothing is checked when every tab is closed.
          </li>
          <li>
            <strong>Offline data is labelled.</strong> Without a connection, AirIQ shows the last data it saved with &ldquo;Offline: showing data from
            HH:MM&rdquo;, and alerts do not run on it.
          </li>
          <li>Open-Meteo keeps about 92 days of air-quality history, and its weather archive can be shorter, so long ranges may cover fewer days.</li>
          <li>
            <strong>NAQI is AirIQ&rsquo;s calculation</strong>, not CPCB&rsquo;s official bulletin, and was not compared against it directly. Station-based
            NAQI uses the gases&rsquo; latest hour instead of CPCB&rsquo;s 24-hour/8-hour means. From model concentrations it inherits the model&rsquo;s
            smoothing; history, forecast and the map always use model concentrations.
          </li>
          <li>
            The AI assistant can make mistakes. Its numbers are checked against the data it fetched, and unmatched figures are flagged, but you should check
            the data panel.
          </li>
        </ul>
      </Section>

      <p className="text-sm text-muted">
        <Link href="/" className="font-medium text-text underline underline-offset-2">
          Back to the dashboard
        </Link>
      </p>
    </article>
  );
}
