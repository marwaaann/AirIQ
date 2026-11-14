/**
 * The single table of health-guidance rules. Every recommendation AirIQ shows
 * is one of these rows; the engine (lib/health-advice.ts) only selects and
 * orders them. Each row cites its source in `basis`.
 *
 * Levels are the category rank on the ACTIVE scale (0 = Good … 5 = Hazardous
 * on US AQI; 0 = Good … 5 = Extremely poor on the European AQI; 0 = Good …
 * 5 = Severe on India's NAQI). The US "Beyond index" band (above 500) has rank
 * 5, so it always gets the strongest (Hazardous) guidance.
 * "sensitive" means the selected profile is a recognised sensitive group for
 * the current main pollutant (see lib/profiles.ts).
 *
 * Sources:
 *  - EPA AirNow Air Quality Guides for particle pollution and ozone (activity
 *    guidance by AQI category and sensitive group).
 *  - EEA European Air Quality Index health recommendations.
 *  - EPA Wildfire Smoke Guide for Public Health Officials (2019, rev. 2021) and
 *    EPA "Guide to Air Cleaners in the Home" (indoor air, filtration, masks).
 *  - WHO Global Air Quality Guidelines (2021).
 *  - CPCB, National Air Quality Index (2014), Table 3.12 health statements
 *    (NAQI headlines). CPCB gives no activity-level advice, so on the NAQI
 *    scale AirIQ applies EPA's activity guidance for the category of the same
 *    severity rank and says so in each row's basis.
 *
 * Pure module (relative imports only).
 */

import type { ProfileId, PollutantGroup } from "./profiles.ts";

export type RuleGroup = "headline" | "activity" | "indoor" | "protection" | "info";
export type ActivityKind = "walking" | "exercise" | "commuting" | "children";
export type Audience = "sensitive" | "general";

export type RuleScale = "us" | "eu" | "in";

export interface RuleCondition {
  scale?: RuleScale;
  /** Exact category ranks this rule applies to. */
  ranks?: readonly number[];
  minRank?: number;
  maxRank?: number;
  audience?: Audience;
  /** Main pollutant must be in one of these groups. */
  pollutantGroups?: readonly PollutantGroup[];
  profiles?: readonly ProfileId[];
  /** Local hour window [start, end) in the city's time zone. */
  localHours?: readonly [number, number];
  /** PM2.5 must exceed the WHO 24-hour guideline. */
  pm25AboveWho?: boolean;
}

export interface HealthRule {
  id: string;
  group: RuleGroup;
  activity?: ActivityKind;
  when: RuleCondition;
  /** Fixed text. Placeholders: {ratio} (PM2.5 ÷ WHO guideline). */
  text: string;
  basis: string;
  /** Lower = more important (used for ordering and the "top 3"). */
  priority: number;
  /** Only used when no other rule in the same group/activity matched. */
  fallback?: boolean;
}

const EPA_GUIDE = "EPA AirNow Air Quality Guide: activity guidance by AQI category";
const EPA_GUIDE_SENS = "EPA AirNow Air Quality Guide: guidance for sensitive groups";
const EEA = "EEA European Air Quality Index health recommendations";
const EEA_SENS = "EEA European Air Quality Index recommendations for sensitive populations";
const EPA_SMOKE = "EPA Wildfire Smoke Guide for Public Health Officials (2019, rev. 2021)";
const EPA_CLEANERS = "EPA Guide to Air Cleaners in the Home";
const CPCB = "CPCB National Air Quality Index (2014), Table 3.12 health statements";
const EPA_ON_NAQI = "EPA AirNow activity guidance, applied by AirIQ to the NAQI category of the same severity (CPCB gives no activity advice)";
const EPA_ON_NAQI_SENS = "EPA AirNow guidance for sensitive groups, applied by AirIQ to the NAQI category of the same severity";

type Tier = readonly [string, string, string, string, string, string];

/** Build one rule per rank from a 6-tier text array. */
function tiers(prefix: string, group: RuleGroup, base: Omit<HealthRule, "id" | "group" | "text" | "when"> & { when: RuleCondition }, texts: Tier): HealthRule[] {
  return texts.map((text, rank) => ({
    ...base,
    id: `${prefix}-${rank}`,
    group,
    text,
    when: { ...base.when, ranks: [rank] },
  }));
}

/* ------------------------------------------------------------------------- */
/* Headlines                                                                  */
/* ------------------------------------------------------------------------- */

const HEADLINES: HealthRule[] = [
  ...tiers("head-us-general", "headline", { when: { scale: "us", audience: "general" }, basis: EPA_GUIDE, priority: 0 }, [
    "Air quality is good. A great day to be active outside.",
    "Air quality is acceptable for most people.",
    "Acceptable for most people; sensitive groups should take it easier.",
    "Unhealthy: everyone should cut back on long or intense outdoor activity.",
    "Very unhealthy: move activities indoors or reschedule them.",
    "Hazardous: everyone should avoid all physical activity outdoors.",
  ]),
  ...tiers("head-us-sensitive", "headline", { when: { scale: "us", audience: "sensitive" }, basis: EPA_GUIDE_SENS, priority: 0 }, [
    "Air quality is good. A great day to be active outside.",
    "Acceptable, but if you are unusually sensitive, watch for symptoms.",
    "Unhealthy for you: make outdoor activities shorter and less intense.",
    "Unhealthy: avoid long or intense outdoor activity.",
    "Very unhealthy for you: avoid all physical activity outdoors.",
    "Hazardous: stay indoors and keep activity levels low.",
  ]),
  ...tiers("head-eu-general", "headline", { when: { scale: "eu", audience: "general" }, basis: EEA, priority: 0 }, [
    "Air quality is good. Enjoy your usual outdoor activities.",
    "Air quality is fair. Enjoy your usual outdoor activities.",
    "Moderate air quality. Enjoy your usual outdoor activities.",
    "Poor air quality. Consider reducing intense outdoor activity if you have symptoms.",
    "Very poor air quality. Consider reducing intense outdoor activity.",
    "Extremely poor air quality. Reduce physical activity outdoors.",
  ]),
  ...tiers("head-eu-sensitive", "headline", { when: { scale: "eu", audience: "sensitive" }, basis: EEA_SENS, priority: 0 }, [
    "Air quality is good. Enjoy your usual outdoor activities.",
    "Air quality is fair. Enjoy your usual outdoor activities.",
    "Moderate air quality. Consider reducing intense outdoor activity if you have symptoms.",
    "Poor air quality for you. Consider reducing physical activity, particularly outdoors.",
    "Very poor air quality for you. Reduce physical activity, particularly outdoors.",
    "Extremely poor air quality. Avoid physical activity outdoors.",
  ]),
  ...tiers("head-in-general", "headline", { when: { scale: "in", audience: "general" }, basis: CPCB, priority: 0 }, [
    "Good: minimal impact.",
    "Satisfactory: may cause minor breathing discomfort to sensitive people.",
    "Moderately polluted: may cause breathing discomfort to people with lung disease such as asthma, and discomfort to people with heart disease, children and older adults.",
    "Poor: may cause breathing discomfort on prolonged exposure, and discomfort to people with heart disease even with short exposure.",
    "Very poor: may cause respiratory illness on prolonged exposure; effects may be more pronounced in people with lung and heart diseases.",
    "Severe: may cause respiratory effects even in healthy people, and serious health impacts in people with lung or heart disease, even during light physical activity.",
  ]),
  ...tiers("head-in-sensitive", "headline", { when: { scale: "in", audience: "sensitive" }, basis: CPCB, priority: 0 }, [
    "Good: minimal impact.",
    "Satisfactory: may cause minor breathing discomfort to sensitive people like you.",
    "Moderately polluted: may cause breathing discomfort for people with lung disease such as asthma, and discomfort for people with heart disease, children and older adults.",
    "Poor: may cause breathing discomfort on prolonged exposure; people with heart disease may feel discomfort even with short exposure.",
    "Very poor: may cause respiratory illness on prolonged exposure, with more pronounced effects for people with lung and heart diseases.",
    "Severe: serious health impacts for people with lung or heart disease, even during light physical activity.",
  ]),
];

/* ------------------------------------------------------------------------- */
/* Outdoor activity                                                           */
/* ------------------------------------------------------------------------- */

const ACTIVITY: HealthRule[] = [
  // US: walking
  ...tiers("walk-us-general", "activity", { activity: "walking", when: { scale: "us", audience: "general" }, basis: EPA_GUIDE, priority: 20 }, [
    "Walk as much as you like.",
    "Fine for walking and other outdoor activity.",
    "Fine for walking.",
    "Take more breaks and keep walks shorter.",
    "Keep walks short; consider moving activities indoors.",
    "Avoid walking outdoors; stay indoors if you can.",
  ]),
  ...tiers("walk-us-sensitive", "activity", { activity: "walking", when: { scale: "us", audience: "sensitive" }, basis: EPA_GUIDE_SENS, priority: 20 }, [
    "Walk as much as you like.",
    "Fine for walking; watch for symptoms such as coughing or shortness of breath.",
    "Take more breaks and do less intense activities.",
    "Keep outdoor time short and avoid long walks.",
    "Avoid all physical activity outdoors, including long walks.",
    "Remain indoors and keep activity levels low.",
  ]),
  // US: running / exercise
  ...tiers("ex-us-general", "activity", { activity: "exercise", when: { scale: "us", audience: "general" }, basis: EPA_GUIDE, priority: 10 }, [
    "Great conditions for outdoor exercise.",
    "Fine for outdoor exercise.",
    "Fine for most people; watch for symptoms such as coughing or shortness of breath.",
    "Reduce long or intense outdoor exercise; take more breaks or move workouts indoors.",
    "Move workouts indoors or reschedule them.",
    "Avoid all physical activity outdoors.",
  ]),
  ...tiers("ex-us-sensitive", "activity", { activity: "exercise", when: { scale: "us", audience: "sensitive" }, basis: EPA_GUIDE_SENS, priority: 10 }, [
    "Great conditions for outdoor exercise.",
    "Consider making long or intense workouts shorter and less intense.",
    "Make workouts shorter and less intense, take more breaks, and watch for symptoms.",
    "Avoid long or intense outdoor exercise; move workouts indoors or reschedule.",
    "Avoid all physical activity outdoors; exercise indoors at low intensity or reschedule.",
    "Do not exercise outdoors; keep activity levels low indoors.",
  ]),
  // EU (EEA does not separate light and intense activity in detail)
  ...tiers("walk-eu-general", "activity", { activity: "walking", when: { scale: "eu", audience: "general" }, basis: EEA, priority: 20 }, [
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Fine for most people; consider shorter walks if you have symptoms such as sore eyes, a cough or sore throat.",
    "Consider shorter walks, especially if you have symptoms.",
    "Reduce time spent active outdoors.",
  ]),
  ...tiers("walk-eu-sensitive", "activity", { activity: "walking", when: { scale: "eu", audience: "sensitive" }, basis: EEA_SENS, priority: 20 }, [
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Fine for walking; reduce intensity if you have symptoms.",
    "Consider reducing physical activity outdoors, especially if you have symptoms.",
    "Reduce physical activity outdoors.",
    "Avoid physical activity outdoors.",
  ]),
  ...tiers("ex-eu-general", "activity", { activity: "exercise", when: { scale: "eu", audience: "general" }, basis: EEA, priority: 10 }, [
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Consider reducing intense outdoor exercise if you have symptoms such as sore eyes, a cough or sore throat.",
    "Consider reducing intense outdoor exercise.",
    "Reduce physical activity outdoors; move workouts indoors.",
  ]),
  ...tiers("ex-eu-sensitive", "activity", { activity: "exercise", when: { scale: "eu", audience: "sensitive" }, basis: EEA_SENS, priority: 10 }, [
    "Enjoy your usual outdoor activities.",
    "Enjoy your usual outdoor activities.",
    "Consider reducing intense outdoor exercise if you have symptoms.",
    "Consider moving intense workouts indoors.",
    "Reduce physical activity, particularly outdoors; exercise indoors instead.",
    "Avoid physical activities outdoors.",
  ]),
  // Children's outdoor play (children profile only)
  ...tiers("play-us", "activity", { activity: "children", when: { scale: "us", profiles: ["children"] }, basis: EPA_GUIDE_SENS, priority: 15 }, [
    "Outdoor play is fine.",
    "Outdoor play is fine; watch unusually sensitive children for coughing or shortness of breath.",
    "Keep outdoor play shorter and less intense, with more breaks.",
    "Keep outdoor play short and calm; move active games indoors.",
    "Keep children indoors for active play.",
    "Keep children indoors with low activity.",
  ]),
  ...tiers("play-eu", "activity", { activity: "children", when: { scale: "eu", profiles: ["children"] }, basis: EEA_SENS, priority: 15 }, [
    "Outdoor play is fine.",
    "Outdoor play is fine.",
    "Reduce intense outdoor play if your child has symptoms.",
    "Consider moving active play indoors.",
    "Move active play indoors.",
    "Keep play indoors.",
  ]),
  // Commuting
  {
    id: "commute-traffic",
    group: "activity",
    activity: "commuting",
    when: { minRank: 1, pollutantGroups: ["no2", "co"] },
    text: "Avoid walking or cycling along busy roads; choose quieter streets where you can.",
    basis: "EPA AirNow: nitrogen dioxide and carbon monoxide come mainly from traffic and are highest near busy roads",
    priority: 12,
  },
  {
    id: "commute-particles",
    group: "activity",
    activity: "commuting",
    when: { minRank: 2, pollutantGroups: ["particles"] },
    text: "Where possible, avoid busy roads and highways, where particle levels are often higher.",
    basis: "EPA AirNow particle pollution guide",
    priority: 14,
  },
  {
    id: "commute-ozone",
    group: "activity",
    activity: "commuting",
    when: { minRank: 2, pollutantGroups: ["ozone"] },
    text: "Commute in the morning if you can; ozone usually builds up during the day.",
    basis: "EPA AirNow ozone guide: ozone is usually lower in the morning",
    priority: 16,
  },
  {
    id: "commute-ok",
    group: "activity",
    activity: "commuting",
    when: {},
    text: "No special precautions needed for your commute.",
    basis: EPA_GUIDE,
    priority: 40,
    fallback: true,
  },
  // Ozone timing
  {
    id: "ozone-timing",
    group: "activity",
    activity: "exercise",
    when: { minRank: 1, pollutantGroups: ["ozone"], audience: "sensitive" },
    text: "Ozone is usually highest in the afternoon and early evening; plan outdoor exercise for the morning.",
    basis: "EPA AirNow ozone guide: ozone levels are usually lower in the morning",
    priority: 11,
  },
  {
    id: "ozone-timing-general",
    group: "activity",
    activity: "exercise",
    when: { minRank: 2, pollutantGroups: ["ozone"], audience: "general" },
    text: "Ozone is usually highest in the afternoon and early evening; plan outdoor exercise for the morning.",
    basis: "EPA AirNow ozone guide: ozone levels are usually lower in the morning",
    priority: 11,
  },
  {
    id: "ozone-now-peak",
    group: "activity",
    activity: "exercise",
    when: { minRank: 1, pollutantGroups: ["ozone"], localHours: [12, 20] },
    text: "It is currently the afternoon/early-evening period when ozone is typically highest.",
    basis: "EPA AirNow ozone guide",
    priority: 12,
  },
];

/**
 * NAQI activity rows: the US activity rows (walking, exercise, children's
 * play) re-labelled for the NAQI scale. The basis says that AirIQ maps the
 * guidance by severity rank, because CPCB publishes no activity advice.
 */
const ACTIVITY_IN: HealthRule[] = ACTIVITY.filter((r) => r.when.scale === "us").map((r) => ({
  ...r,
  id: r.id.replace("-us", "-in"),
  when: { ...r.when, scale: "in" },
  basis: r.basis === EPA_GUIDE ? EPA_ON_NAQI : EPA_ON_NAQI_SENS,
}));

/* ------------------------------------------------------------------------- */
/* Indoor air                                                                 */
/* ------------------------------------------------------------------------- */

const INDOOR: HealthRule[] = [
  {
    id: "windows-open",
    group: "indoor",
    when: { maxRank: 1 },
    text: "A good time to open windows and air out your home.",
    basis: `${EPA_SMOKE}: ventilate when outdoor air is clean`,
    priority: 30,
  },
  {
    id: "windows-closed",
    group: "indoor",
    when: { minRank: 2 },
    text: "Keep windows and doors closed; air out your home during the cleaner hours shown in the window finder.",
    basis: `${EPA_SMOKE}: keep outdoor pollution out when air quality is poor`,
    priority: 21,
  },
  {
    id: "purifier-particles",
    group: "indoor",
    when: { minRank: 2, pollutantGroups: ["particles"] },
    text: "Run an air purifier with a HEPA filter, or set your ventilation system to recirculate through a high-efficiency (MERV 13 or higher) filter.",
    basis: EPA_CLEANERS,
    priority: 22,
  },
  {
    id: "indoor-sources",
    group: "indoor",
    when: { minRank: 2, pollutantGroups: ["particles"] },
    text: "Avoid adding particles indoors: no smoking, candles or incense, and avoid frying or broiling food.",
    basis: `${EPA_SMOKE}: reduce indoor sources of particles`,
    priority: 23,
  },
  {
    id: "purifier-gases",
    group: "indoor",
    when: { minRank: 2, pollutantGroups: ["ozone", "no2", "so2", "co"] },
    text: "HEPA purifiers remove particles, not gases such as ozone or NO₂; keeping windows closed during the worst hours is what helps.",
    basis: `${EPA_CLEANERS}: particle filters do not remove gases`,
    priority: 24,
  },
];

/* ------------------------------------------------------------------------- */
/* Protection                                                                 */
/* ------------------------------------------------------------------------- */

const PROTECTION: HealthRule[] = [
  {
    id: "mask-particles-general",
    group: "protection",
    when: { minRank: 3, pollutantGroups: ["particles"], audience: "general" },
    text: "If you must spend a long time outdoors, a well-fitting N95 or P100 respirator reduces particle exposure. It only works if it fits well and seals around the face; cloth and surgical masks give little protection from fine particles.",
    basis: `${EPA_SMOKE}: respirators and fit`,
    priority: 25,
  },
  {
    id: "mask-particles-sensitive",
    group: "protection",
    when: { minRank: 2, pollutantGroups: ["particles"], audience: "sensitive" },
    text: "If you must spend a long time outdoors, a well-fitting N95 or P100 respirator reduces particle exposure. It only works if it fits well and seals around the face; cloth and surgical masks give little protection from fine particles. If you have a heart or lung condition, ask your doctor whether a respirator is right for you.",
    basis: `${EPA_SMOKE}: respirators, fit, and advice for people with heart or lung disease`,
    priority: 25,
  },
  {
    id: "mask-gases",
    group: "protection",
    when: { minRank: 2, pollutantGroups: ["ozone", "no2", "so2", "co"] },
    text: "Masks, including N95s, do not filter gases such as ozone, NO₂, SO₂ or CO; limiting time and effort outdoors is the main protection.",
    basis: `${EPA_SMOKE}: particulate respirators do not protect against gases`,
    priority: 26,
  },
  {
    id: "asthma-plan",
    group: "protection",
    when: { minRank: 2, profiles: ["respiratory"], audience: "sensitive" },
    text: "Keep your quick-relief medicine with you and follow your asthma action plan.",
    basis: "EPA AirNow: advice for people with asthma",
    priority: 13,
  },
  {
    id: "heart-symptoms",
    group: "protection",
    when: { minRank: 2, profiles: ["older"], audience: "sensitive" },
    text: "If you have heart or lung disease, watch for symptoms such as chest pain, palpitations or shortness of breath, and contact your doctor if they occur.",
    basis: "EPA AirNow: advice for people with heart disease",
    priority: 14,
  },
  {
    id: "protection-none",
    group: "protection",
    when: {},
    text: "No protective equipment is needed at this level.",
    basis: EPA_GUIDE,
    priority: 45,
    fallback: true,
  },
];

/* ------------------------------------------------------------------------- */
/* Info                                                                        */
/* ------------------------------------------------------------------------- */

const INFO: HealthRule[] = [
  {
    id: "who-pm25",
    group: "info",
    when: { pm25AboveWho: true },
    text: "PM2.5 is {ratio}× the WHO 24-hour guideline of 15 µg/m³.",
    basis: "WHO Global Air Quality Guidelines (2021)",
    priority: 50,
  },
];

export const HEALTH_RULES: readonly HealthRule[] = [...HEADLINES, ...ACTIVITY, ...ACTIVITY_IN, ...INDOOR, ...PROTECTION, ...INFO];
