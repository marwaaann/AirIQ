/**
 * Single source of truth for AQI categories, colors, health messages,
 * pollutant metadata and WHO guideline values.
 *
 * Pure module (no imports from "@/") so it can run under `node --test`.
 */

export type UsCategoryKey =
  | "good"
  | "moderate"
  | "usg"
  | "unhealthy"
  | "very-unhealthy"
  | "hazardous";

export type EuCategoryKey = "good" | "fair" | "moderate" | "poor" | "very-poor" | "extremely-poor";

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
  pattern: "none" | "dots" | "lines" | "cross" | "grid" | "solid-stripes";
  /** 0-based severity rank shared across scales (0 best, 5 worst). */
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
    textColor: "#ffffff",
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
    max: Number.POSITIVE_INFINITY,
    color: "#7e0023",
    textColor: "#ffffff",
    verdict: "Emergency conditions. Avoid going outside.",
    health: "Health warning of emergency conditions: everyone is more likely to be affected.",
    sensitive: "Everyone should avoid all outdoor physical activity.",
    pattern: "solid-stripes",
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
    textColor: "#ffffff",
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

export function getUsCategory(aqi: number): AqiCategory<UsCategoryKey> {
  const v = Math.max(0, Math.round(aqi));
  return US_CATEGORIES.find((c) => v >= c.min && v <= c.max) ?? US_CATEGORIES[US_CATEGORIES.length - 1];
}

export function getEuCategory(aqi: number): AqiCategory<EuCategoryKey> {
  const v = Math.max(0, aqi);
  // Bands are (min, max]; the first band whose upper bound covers v wins.
  return EU_CATEGORIES.find((c) => v <= c.max) ?? EU_CATEGORIES[EU_CATEGORIES.length - 1];
}

export function getCategory(aqi: number, scale: "us" | "eu"): AqiCategory {
  return scale === "us" ? getUsCategory(aqi) : getEuCategory(aqi);
}

/** Max value used to scale gauges for each AQI scale. */
export const SCALE_MAX: Record<"us" | "eu", number> = { us: 500, eu: 125 };

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
