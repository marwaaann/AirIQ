import "server-only";

import { z } from "@/lib/zod";

/**
 * Server environment, validated in one place.
 *
 * AirIQ needs no keys: all core data comes from Open-Meteo. Every variable here
 * is optional. A missing or invalid value never throws; it turns the feature
 * off, and the UI says why ("Ground stations: not configured", "Assistant not
 * configured"). Warnings name the variable, never its value.
 *
 * Build-time values (AIRIQ_BUILD_VERSION, NODE_ENV) are read in next.config.ts
 * and inlined into the client bundle; they are not secrets.
 */

/** Empty or whitespace-only strings count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

const RawEnvSchema = z.object({
  WAQI_TOKEN: optional,
  OPENAQ_API_KEY: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: optional,
  GEMINI_FALLBACK_MODEL: optional,
  GEMINI_BASE_URL: optional,
  SITE_URL: optional,
});

const HttpUrl = z.url({ protocol: /^https?$/ });
/** Model ids such as "gemini-3.6-flash"; "off"/"none" is allowed for the fallback. */
const ModelId = z.string().regex(/^[a-z0-9][a-z0-9.\-_/]{1,80}$/i);

export const DEFAULT_SITE_URL = "http://localhost:3000";

export interface AppEnv {
  waqiToken?: string;
  openaqKey?: string;
  geminiKey?: string;
  geminiModel?: string;
  geminiFallbackModel?: string;
  /** Testing only: send Gemini requests to a mock server. */
  geminiBaseUrl?: string;
  /** Absolute base for Open Graph links. */
  siteUrl: string;
}

export interface FeatureStatus {
  id: "air-data" | "stations" | "assistant";
  label: string;
  enabled: boolean;
  /** Plain-English reason shown in the UI and the startup log. Never contains a secret. */
  detail: string;
}

export interface EnvReport {
  env: AppEnv;
  features: FeatureStatus[];
  /** Problems found (by variable name only). */
  warnings: string[];
}

/** Pure: validate a raw environment object. Never throws. */
export function parseEnv(raw: Record<string, string | undefined>): EnvReport {
  const warnings: string[] = [];
  const r = RawEnvSchema.parse({
    WAQI_TOKEN: raw.WAQI_TOKEN,
    OPENAQ_API_KEY: raw.OPENAQ_API_KEY,
    GEMINI_API_KEY: raw.GEMINI_API_KEY,
    GEMINI_MODEL: raw.GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL: raw.GEMINI_FALLBACK_MODEL,
    GEMINI_BASE_URL: raw.GEMINI_BASE_URL,
    SITE_URL: raw.SITE_URL,
  });

  const url = (name: "SITE_URL" | "GEMINI_BASE_URL", v: string | undefined) => {
    if (v === undefined) return undefined;
    if (HttpUrl.safeParse(v).success) return v.replace(/\/+$/, "");
    warnings.push(`${name} is not a valid http(s) URL and was ignored.`);
    return undefined;
  };
  const model = (name: "GEMINI_MODEL" | "GEMINI_FALLBACK_MODEL", v: string | undefined) => {
    if (v === undefined) return undefined;
    if (ModelId.safeParse(v).success) return v;
    warnings.push(`${name} does not look like a model id and was ignored (the default is used).`);
    return undefined;
  };

  const env: AppEnv = {
    waqiToken: r.WAQI_TOKEN,
    openaqKey: r.OPENAQ_API_KEY,
    geminiKey: r.GEMINI_API_KEY,
    geminiModel: model("GEMINI_MODEL", r.GEMINI_MODEL),
    geminiFallbackModel: model("GEMINI_FALLBACK_MODEL", r.GEMINI_FALLBACK_MODEL),
    geminiBaseUrl: url("GEMINI_BASE_URL", r.GEMINI_BASE_URL),
    siteUrl: url("SITE_URL", r.SITE_URL) ?? DEFAULT_SITE_URL,
  };

  const stationSource = env.waqiToken ? "WAQI" : env.openaqKey ? "OpenAQ" : null;
  const features: FeatureStatus[] = [
    { id: "air-data", label: "Air quality, weather and geocoding", enabled: true, detail: "Open-Meteo (no key needed)." },
    {
      id: "stations",
      label: "Ground stations on the map",
      enabled: stationSource !== null,
      detail: stationSource
        ? `${stationSource}${env.waqiToken && env.openaqKey ? " (OpenAQ as backup)" : ""}.`
        : "Not configured: set WAQI_TOKEN or OPENAQ_API_KEY to show measured station readings.",
    },
    {
      id: "assistant",
      label: "AI assistant",
      enabled: Boolean(env.geminiKey),
      detail: env.geminiKey ? "Google Gemini." : "Not configured: set GEMINI_API_KEY to enable the assistant.",
    },
  ];
  if (env.geminiBaseUrl && raw.NODE_ENV === "production") {
    warnings.push("GEMINI_BASE_URL is set in production; it is meant for testing with a mock server.");
  }
  return { env, features, warnings };
}

/** Current server environment (re-read on each call, so tests and restarts see changes). */
export function getEnvReport(): EnvReport {
  return parseEnv(process.env);
}

export function getEnv(): AppEnv {
  return getEnvReport().env;
}

/** One-line summary for the startup log. Contains no secret values. */
export function envSummary(report: EnvReport): string {
  return report.features.map((f) => `${f.label}: ${f.enabled ? "on" : "off"}`).join(" | ");
}
