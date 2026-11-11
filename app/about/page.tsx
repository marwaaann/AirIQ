import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { getEnvReport } from "@/lib/env";

export const metadata: Metadata = {
  title: "About, sources and methods",
  description: "What AirIQ is, where its data comes from and under which terms, how the AQI, trend model and correlations are calculated, and the known limitations.",
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
      used: "Optional ground-station markers on the map (US AQI only), when a WAQI token is configured.",
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
      used: "Optional backup source for ground-station PM2.5, when an OpenAQ key is configured.",
      terms: (
        <>
          Attribution to OpenAQ is required, and users must acknowledge the original data providers when they require it (
          <Ext href="https://docs.openaq.org/about/terms">OpenAQ terms</Ext>). Station popups name OpenAQ and link to the location on OpenAQ Explorer.
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
        <p className="text-xs text-muted">Terms were checked on the providers&rsquo; own pages on 11 November 2026.</p>
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
          <div>
            <h3 className="font-semibold">AQI</h3>
            <p>
              The headline numbers are Open-Meteo&rsquo;s US AQI and European AQI, computed from CAMS concentrations. The US index uses the EPA breakpoints
              (May 2024 revision, with 24-hour PM averages and 8-hour ozone); the European index uses the EEA bands on hourly values. The main pollutant is the
              one with the highest sub-index. AirIQ recomputes the US index itself as a visible cross-check. Every category has a colour, a pattern and a text
              label, so colour is never the only cue.
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
              Advice is selected from a fixed table of rules based on the US EPA AirNow Air Quality Guide, the EEA index recommendations, EPA guidance on wildfire
              smoke and air cleaners, and WHO 2021 guideline values. Nothing in it is generated by AI.
            </p>
          </div>
        </div>
      </Section>

      <Section id="about-limits" title="Known limitations">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Grid data is modelled, not measured.</strong> CAMS values are model estimates for cells of about 11 km (Europe) to 45 km (elsewhere). They
            smooth out local hot spots such as busy roads. The map heatmap is interpolated between grid points.
          </li>
          <li>
            <strong>Ground stations vary in coverage.</strong> They are optional, dense in some cities and absent in others. WAQI gives only an AQI per station,
            and readings older than 6 hours are hidden.
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
