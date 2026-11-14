/**
 * Single source of truth for AQI categories, colors, health messages,
 * pollutant metadata and WHO guideline values.
 *
 * Pure module (no imports from "@/") so it can run under `node --test`.
 */

/** The three index scales AirIQ shows: US EPA, European (EEA) and India's National AQI (CPCB). */
export type ScaleKey = "us" | "eu" | "in";
export const SCALES: readonly ScaleKey[] = ["us", "eu", "in"];

export type UsCategoryKey =
  | "good"
  | "moderate"
  | "usg"
  | "unhealthy"
  | "very-unhealthy"
  | "hazardous"
  | "beyond-index";

export type EuCategoryKey = "good" | "fair" | "moderate" | "poor" | "very-poor" | "extremely-poor";

export type InCategoryKey = "good" | "satisfactory" | "moderately-polluted" | "poor" | "very-poor" | "severe";

export interface AqiCategory<K extends string = string> {
  key: K;
  label: string;
  /** Inclusive lower bound of the index range. */
  min: number;
  /** Inclusive upper bound (Infinity for the last band). */
  max: number;
  /** Background color (official palette). */
  color: string;
  /** Readable text color on top of `color`. */
  textColor: string;
  /** Short, plain-English verdict for the hero card. */
  verdict: string;
  /** General-population health message. */
  health: string;
  /** Message for sensitive groups. */
  sensitive: string;
  /** Pattern id used as a non-color cue (color-blind safety). */
  pattern: "none" | "dots" | "lines" | "cross" | "grid" | "solid-stripes" | "zigzag";
  /**
   * 0-based severity rank shared across scales (0 best, 5 worst). The US
   * "Beyond index" band shares rank 5 with Hazardous, so every rule written
   * for the worst category applies to it too.
   */
  rank: number;
}

/** US EPA AQI categories with official EPA colors. */
export const US_CATEGORIES: readonly AqiCategory<UsCategoryKey>[] = [
  {
    key: "good",
    label: "Good",
    min: 0,
    max: 50,
    color: "#00e400",
    textColor: "#0b2e0b",
    verdict: "Air quality is good. Enjoy the outdoors.",
    health: "Air quality is satisfactory, and air pollution poses little or no risk.",
    sensitive: "No precautions needed.",
    pattern: "none",
    rank: 0,
  },
  {
    key: "moderate",
    label: "Moderate",
    min: 51,
    max: 100,
    color: "#ffff00",
    textColor: "#3d3d00",
    verdict: "Acceptable air. Unusually sensitive people should take it easy.",
    health: "Air quality is acceptable. There may be a risk for some people, particularly those unusually sensitive to air pollution.",
    sensitive: "Unusually sensitive people should consider reducing prolonged or heavy exertion outdoors.",
    pattern: "dots",
    rank: 1,
  },
  {
    key: "usg",
    label: "Unhealthy for Sensitive Groups",
    min: 101,
    max: 150,
    color: "#ff7e00",
    textColor: "#3a1d00",
    verdict: "Sensitive groups should limit time outdoors.",
    health: "Members of sensitive groups may experience health effects. The general public is less likely to be affected.",
    sensitive: "People with heart or lung disease, older adults, children and teens should reduce prolonged or heavy exertion.",
    pattern: "lines",
    rank: 2,
  },
  {
    key: "unhealthy",
    label: "Unhealthy",
    min: 151,
    max: 200,
    color: "#ff0000",
    // White on #ff0000 is 4.0:1 (fails WCAG AA); near-black is 5.0:1.
    textColor: "#1a0000",
    verdict: "Unhealthy air. Limit outdoor activity.",
    health: "Some members of the general public may experience health effects; sensitive groups may experience more serious effects.",
    sensitive: "Sensitive groups should avoid prolonged or heavy exertion; everyone else should reduce it.",
    pattern: "cross",
    rank: 3,
  },
  {
    key: "very-unhealthy",
    label: "Very Unhealthy",
    min: 201,
    max: 300,
    color: "#8f3f97",
    textColor: "#ffffff",
    verdict: "Health alert. Stay indoors where possible.",
    health: "Health alert: the risk of health effects is increased for everyone.",
    sensitive: "Sensitive groups should avoid all physical activity outdoors.",
    pattern: "grid",
    rank: 4,
  },
  {
    key: "hazardous",
    label: "Hazardous",
    min: 301,
    max: 500,
    color: "#7e0023",
    textColor: "#ffffff",
    verdict: "Emergency conditions. Avoid going outside.",
    health: "Health warning of emergency conditions: everyone is more likely to be affected.",
    sensitive: "Everyone should avoid all outdoor physical activity.",
    pattern: "solid-stripes",
    rank: 5,
  },
  {
    // Not an EPA category: the EPA index stops at 500. AirIQ keeps the computed
    // value (linear extension of the top band), shows "500+" and uses this band
    // so an extreme reading is never drawn as an ordinary Hazardous one.
    key: "beyond-index",
    label: "Beyond index",
    min: 501,
    max: Number.POSITIVE_INFINITY,
    color: "#3d000f",
    textColor: "#ffffff",
    verdict: "Beyond the top of the index. Stay indoors.",
    health: "The reading is above the highest value the US AQI defines (500). Health warning of emergency conditions applies to everyone.",
    sensitive: "Everyone should stay indoors and avoid all physical activity outdoors.",
    pattern: "zigzag",
    rank: 5,
  },
] as const;

/** European Air Quality Index (EEA) bands as used by Open-Meteo's `european_aqi`. */
export const EU_CATEGORIES: readonly AqiCategory<EuCategoryKey>[] = [
  {
    key: "good",
    label: "Good",
    min: 0,
    max: 20,
    color: "#50f0e6",
    textColor: "#073b38",
    verdict: "Air quality is good. Enjoy the outdoors.",
    health: "The air quality is good. Enjoy your usual outdoor activities.",
    sensitive: "Enjoy your usual outdoor activities.",
    pattern: "none",
    rank: 0,
  },
  {
    key: "fair",
    label: "Fair",
    min: 20,
    max: 40,
    color: "#50ccaa",
    textColor: "#08362a",
    verdict: "Air quality is fair. Fine for most activities.",
    health: "Enjoy your usual outdoor activities.",
    sensitive: "Enjoy your usual outdoor activities.",
    pattern: "dots",
    rank: 1,
  },
  {
    key: "moderate",
    label: "Moderate",
    min: 40,
    max: 60,
    color: "#f0e641",
    textColor: "#3a3500",
    verdict: "Moderate air. Sensitive people may want to cut back.",
    health: "Enjoy your usual outdoor activities.",
    sensitive: "Consider reducing intense outdoor activities if you experience symptoms.",
    pattern: "lines",
    rank: 2,
  },
  {
    key: "poor",
    label: "Poor",
    min: 60,
    max: 80,
    color: "#ff5050",
    // White on #ff5050 is 3.2:1 (fails WCAG AA); near-black is 6.2:1.
    textColor: "#1a0000",
    verdict: "Poor air. Reduce intense outdoor activity.",
    health: "Consider reducing intense activities outdoors if you experience symptoms such as sore eyes, a cough or sore throat.",
    sensitive: "Consider reducing physical activities, particularly outdoors, especially if you experience symptoms.",
    pattern: "cross",
    rank: 3,
  },
  {
    key: "very-poor",
    label: "Very Poor",
    min: 80,
    max: 100,
    color: "#960032",
    textColor: "#ffffff",
    verdict: "Very poor air. Limit time outdoors.",
    health: "Consider reducing intense activities outdoors if you experience symptoms such as sore eyes, a cough or sore throat.",
    sensitive: "Reduce physical activities, particularly outdoors, especially if you experience symptoms.",
    pattern: "grid",
    rank: 4,
  },
  {
    key: "extremely-poor",
    label: "Extremely Poor",
    min: 100,
    max: Number.POSITIVE_INFINITY,
    color: "#7d2181",
    textColor: "#ffffff",
    verdict: "Extremely poor air. Avoid outdoor activity.",
    health: "Reduce physical activities outdoors.",
    sensitive: "Avoid physical activities outdoors.",
    pattern: "solid-stripes",
    rank: 5,
  },
] as const;

/**
 * India National Air Quality Index (CPCB). Bands and health statements from
 * CPCB, "National Air Quality Index" (2014), Table 3.12, and CPCB's
 * "About National Air Quality Index" sheet. The six colours follow CPCB's
 * green → dark-red legend; the exact hex values are AirIQ's, chosen so the
 * category text meets WCAG AA contrast.
 */
export const IN_CATEGORIES: readonly AqiCategory<InCategoryKey>[] = [
  {
    key: "good",
    label: "Good",
    min: 0,
    max: 50,
    color: "#2fa84f",
    textColor: "#04210c",
    verdict: "Good air. Minimal impact.",
    health: "Minimal impact.",
    sensitive: "Minimal impact.",
    pattern: "none",
    rank: 0,
  },
  {
    key: "satisfactory",
    label: "Satisfactory",
    min: 51,
    max: 100,
    color: "#a3d65c",
    textColor: "#1f2e05",
    verdict: "Satisfactory air. Sensitive people may notice minor discomfort.",
    health: "May cause minor breathing discomfort to sensitive people.",
    sensitive: "May cause minor breathing discomfort to sensitive people.",
    pattern: "dots",
    rank: 1,
  },
  {
    key: "moderately-polluted",
    label: "Moderately polluted",
    min: 101,
    max: 200,
    color: "#ffff00",
    textColor: "#3d3d00",
    verdict: "Moderately polluted. People with lung or heart disease should take care.",
    health:
      "May cause breathing discomfort to the people with lung disease such as asthma and discomfort to people with heart disease, children and older adults.",
    sensitive: "May cause breathing discomfort to people with lung disease such as asthma, and discomfort to people with heart disease, children and older adults.",
    pattern: "lines",
    rank: 2,
  },
  {
    key: "poor",
    label: "Poor",
    min: 201,
    max: 300,
    color: "#ff9a00",
    textColor: "#3a1d00",
    verdict: "Poor air. Limit prolonged time outdoors.",
    health: "May cause breathing discomfort to people on prolonged exposure and discomfort to people with heart disease with short exposure.",
    sensitive: "People with heart disease may feel discomfort even with short exposure.",
    pattern: "cross",
    rank: 3,
  },
  {
    key: "very-poor",
    label: "Very poor",
    min: 301,
    max: 400,
    color: "#d7191c",
    textColor: "#ffffff",
    verdict: "Very poor air. Stay indoors where possible.",
    health: "May cause respiratory illness to the people on prolonged exposure. Effect may be more pronounced in people with lung and heart diseases.",
    sensitive: "Effects may be more pronounced in people with lung and heart diseases.",
    pattern: "grid",
    rank: 4,
  },
  {
    key: "severe",
    label: "Severe",
    min: 401,
    max: Number.POSITIVE_INFINITY,
    color: "#a50f15",
    textColor: "#ffffff",
    verdict: "Severe pollution. Stay indoors.",
    health:
      "May cause respiratory effects even on healthy people and serious health impacts on people with lung/heart diseases. The health impacts may be experienced even during light physical activity.",
    sensitive: "Serious health impacts on people with lung or heart diseases, even during light physical activity.",
    pattern: "solid-stripes",
    rank: 5,
  },
] as const;

export function getUsCategory(aqi: number): AqiCategory<UsCategoryKey> {
  const v = Math.max(0, Math.round(aqi));
  return US_CATEGORIES.find((c) => v >= c.min && v <= c.max) ?? US_CATEGORIES[US_CATEGORIES.length - 1];
}

export function getEuCategory(aqi: number): AqiCategory<EuCategoryKey> {
  const v = Math.max(0, aqi);
  // Bands are (min, max]; the first band whose upper bound covers v wins.
  return EU_CATEGORIES.find((c) => v <= c.max) ?? EU_CATEGORIES[EU_CATEGORIES.length - 1];
}

export function getInCategory(aqi: number): AqiCategory<InCategoryKey> {
  const v = Math.max(0, Math.round(aqi));
  return IN_CATEGORIES.find((c) => v >= c.min && v <= c.max) ?? IN_CATEGORIES[IN_CATEGORIES.length - 1];
}

/** Every category of a scale, best first (the US list includes "Beyond index"). */
export function categoriesFor(scale: ScaleKey): readonly AqiCategory[] {
  return scale === "us" ? US_CATEGORIES : scale === "eu" ? EU_CATEGORIES : IN_CATEGORIES;
}

/** Categories drawn on a gauge or used for chart bands: the index's own range, without "Beyond index". */
export function gaugeCategories(scale: ScaleKey): readonly AqiCategory[] {
  return categoriesFor(scale).filter((c) => c.min <= INDEX_TOP[scale]);
}

export function getCategory(aqi: number, scale: ScaleKey): AqiCategory {
  return scale === "us" ? getUsCategory(aqi) : scale === "eu" ? getEuCategory(aqi) : getInCategory(aqi);
}

/** Max value used to scale gauges and chart bands for each scale. */
export const SCALE_MAX: Record<ScaleKey, number> = { us: 500, eu: 125, in: 500 };

/**
 * Highest value each index defines. Above it a reading is "beyond index": the
 * computed value is kept (for tooltips and logic) but displayed as "500+"
 * (US AQI, India NAQI) or "100+" (European AQI, whose bands end at 100).
 */
export const INDEX_TOP: Record<ScaleKey, number> = { us: 500, eu: 100, in: 500 };

export const SCALE_NAME: Record<ScaleKey, string> = { us: "US AQI", eu: "European AQI", in: "India NAQI" };
export const SCALE_SHORT: Record<ScaleKey, string> = { us: "US AQI", eu: "EU AQI", in: "NAQI" };

export function isBeyondIndex(value: number | null | undefined, scale: ScaleKey): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > INDEX_TOP[scale];
}

/** Text for an index value: "n/a", "231", or "500+" when beyond the index. Never NaN. */
export function formatIndex(value: number | null | undefined, scale: ScaleKey): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return isBeyondIndex(value, scale) ? `${INDEX_TOP[scale]}+` : String(Math.max(0, Math.round(value)));
}

/** Plain-language flag for a beyond-index value, e.g. "Severe, beyond index (computed 612)". */
export function beyondIndexLabel(value: number, scale: ScaleKey): string {
  const name = scale === "us" ? "Beyond index" : scale === "eu" ? "Extremely poor, beyond index" : "Severe, beyond index";
  return `${name} (computed ${Math.round(value)})`;
}

/** Spoken/tooltip form: "US AQI 231" or "US AQI 500+ (Beyond index, computed 648)". */
export function describeIndex(value: number | null | undefined, scale: ScaleKey): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${SCALE_NAME[scale]} not available`;
  return isBeyondIndex(value, scale)
    ? `${SCALE_NAME[scale]} ${formatIndex(value, scale)} (${beyondIndexLabel(value, scale)})`
    : `${SCALE_NAME[scale]} ${Math.round(value)}`;
}

/* ------------------------------------------------------------------------- */
/* Pollutant metadata                                                         */
/* ------------------------------------------------------------------------- */

export type PollutantKey =
  | "pm2_5"
  | "pm10"
  | "nitrogen_dioxide"
  | "sulphur_dioxide"
  | "ozone"
  | "carbon_monoxide";

export interface PollutantInfo {
  key: PollutantKey;
  short: string;
  name: string;
  unit: "µg/m³";
  /** WHO 2021 Air Quality Guideline level (µg/m³). */
  who: { value: number; averaging: string };
  description: string;
}

/**
 * WHO Global Air Quality Guidelines (2021).
 * CO: WHO gives 4 mg/m³ (24-h) = 4000 µg/m³.
 * O3: 100 µg/m³ 8-hour daily maximum.
 * NO2 / SO2 / PM: 24-hour guideline values (best match for hourly readings).
 */
export const POLLUTANT_INFO: Record<PollutantKey, PollutantInfo> = {
  pm2_5: {
    key: "pm2_5",
    short: "PM2.5",
    name: "Fine particulate matter",
    unit: "µg/m³",
    who: { value: 15, averaging: "24-hour" },
    description: "Particles ≤2.5 µm that reach deep into the lungs and bloodstream. From combustion, traffic, industry and wildfire smoke.",
  },
  pm10: {
    key: "pm10",
    short: "PM10",
    name: "Coarse particulate matter",
    unit: "µg/m³",
    who: { value: 45, averaging: "24-hour" },
    description: "Particles ≤10 µm such as dust, pollen and mold. Irritates airways.",
  },
  nitrogen_dioxide: {
    key: "nitrogen_dioxide",
    short: "NO₂",
    name: "Nitrogen dioxide",
    unit: "µg/m³",
    who: { value: 25, averaging: "24-hour" },
    description: "Traffic and power-plant gas. Inflames airways and worsens asthma.",
  },
  sulphur_dioxide: {
    key: "sulphur_dioxide",
    short: "SO₂",
    name: "Sulphur dioxide",
    unit: "µg/m³",
    who: { value: 40, averaging: "24-hour" },
    description: "From burning coal and oil. Causes breathing difficulty, especially for people with asthma.",
  },
  ozone: {
    key: "ozone",
    short: "O₃",
    name: "Ozone (ground level)",
    unit: "µg/m³",
    who: { value: 100, averaging: "8-hour" },
    description: "Formed by sunlight acting on traffic and industrial emissions. Peaks on sunny afternoons.",
  },
  carbon_monoxide: {
    key: "carbon_monoxide",
    short: "CO",
    name: "Carbon monoxide",
    unit: "µg/m³",
    who: { value: 4000, averaging: "24-hour" },
    description: "Colorless gas from incomplete combustion. Reduces oxygen delivery in the body.",
  },
};

export const POLLUTANT_ORDER: readonly PollutantKey[] = [
  "pm2_5",
  "pm10",
  "nitrogen_dioxide",
  "sulphur_dioxide",
  "ozone",
  "carbon_monoxide",
];

/** Rule of thumb (Berkeley Earth): 22 µg/m³ PM2.5 for 24 h ≈ 1 cigarette. */
export const PM25_PER_CIGARETTE = 22;
