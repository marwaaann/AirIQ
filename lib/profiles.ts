/**
 * Health profiles. Each profile lists the pollutant groups for which EPA/EEA
 * guidance names it as a sensitive group, with the source. Pure module.
 */

export type PollutantGroup = "particles" | "ozone" | "no2" | "so2" | "co";

export const PROFILE_IDS = ["general", "respiratory", "older", "children", "pregnancy", "athlete"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface Profile {
  id: ProfileId;
  label: string;
  description: string;
  /** Pollutant groups for which this profile is a recognised sensitive group. */
  sensitiveTo: readonly PollutantGroup[];
  /** Where the sensitivity comes from. */
  basis: string;
  /**
   * Index at which guidance tightens for this profile (when the main pollutant
   * is one it is sensitive to): the EPA "Unhealthy for Sensitive Groups" line
   * (US 101), the EEA "Moderate" band where sensitive-group advice starts (EU 40),
   * or CPCB's "Moderately polluted" band, whose health statement first names
   * people with lung or heart disease, children and older adults (NAQI 101).
   */
  tightenAt: { us: number; eu: number; in: number };
  /**
   * Default alert threshold (alert when the index goes ABOVE it). NAQI:
   * sensitive profiles at 100 (Moderately polluted, CPCB's first statement
   * about people with lung/heart disease, children and older adults); general
   * at 200 (Poor: "breathing discomfort to people on prolonged exposure").
   */
  defaultThreshold: { us: number; eu: number; in: number };
}

const SENSITIVE_TIGHTEN = { us: 101, eu: 40, in: 101 } as const;
const GENERAL_TIGHTEN = { us: 151, eu: 60, in: 201 } as const;
const SENSITIVE_THRESHOLD = { us: 100, eu: 40, in: 100 } as const;
const GENERAL_THRESHOLD = { us: 150, eu: 60, in: 200 } as const;

export const PROFILES: Record<ProfileId, Profile> = {
  general: {
    id: "general",
    label: "General",
    description: "Healthy adults with no specific sensitivity.",
    sensitiveTo: [],
    basis: "EPA AirNow: guidance for the general public by AQI category.",
    tightenAt: GENERAL_TIGHTEN,
    defaultThreshold: GENERAL_THRESHOLD,
  },
  respiratory: {
    id: "respiratory",
    label: "Asthma / respiratory condition",
    description: "Asthma, COPD or other lung disease.",
    sensitiveTo: ["particles", "ozone", "no2", "so2"],
    basis:
      "EPA AirNow: people with lung disease such as asthma are a sensitive group for particle pollution, ozone, nitrogen dioxide and sulfur dioxide.",
    tightenAt: SENSITIVE_TIGHTEN,
    defaultThreshold: SENSITIVE_THRESHOLD,
  },
  older: {
    id: "older",
    label: "Older adult",
    description: "Adults aged about 65 and over.",
    sensitiveTo: ["particles", "ozone", "so2"],
    basis: "EPA AirNow: older adults are a sensitive group for particle pollution, ozone and sulfur dioxide.",
    tightenAt: SENSITIVE_TIGHTEN,
    defaultThreshold: SENSITIVE_THRESHOLD,
  },
  children: {
    id: "children",
    label: "Children",
    description: "Children and teenagers.",
    sensitiveTo: ["particles", "ozone", "no2", "so2"],
    basis: "EPA AirNow: children and teenagers are a sensitive group for particle pollution, ozone, nitrogen dioxide and sulfur dioxide.",
    tightenAt: SENSITIVE_TIGHTEN,
    defaultThreshold: SENSITIVE_THRESHOLD,
  },
  pregnancy: {
    id: "pregnancy",
    label: "Pregnancy",
    description: "Pregnant people.",
    sensitiveTo: ["particles"],
    basis: "EPA Wildfire Smoke Guide for Public Health Officials (2019, rev. 2021): pregnant people are listed as sensitive to particle pollution.",
    tightenAt: SENSITIVE_TIGHTEN,
    defaultThreshold: SENSITIVE_THRESHOLD,
  },
  athlete: {
    id: "athlete",
    label: "Athlete / outdoor exerciser",
    description: "People who exercise or work hard outdoors.",
    sensitiveTo: ["ozone"],
    basis: "EPA AirNow ozone guide: people who are active outdoors, including outdoor workers, are a sensitive group for ozone.",
    tightenAt: SENSITIVE_TIGHTEN,
    defaultThreshold: SENSITIVE_THRESHOLD,
  },
};

export function isProfileId(v: unknown): v is ProfileId {
  return typeof v === "string" && (PROFILE_IDS as readonly string[]).includes(v);
}

const GROUP_OF: Record<string, PollutantGroup> = {
  pm2_5: "particles",
  pm10: "particles",
  ozone: "ozone",
  nitrogen_dioxide: "no2",
  sulphur_dioxide: "so2",
  carbon_monoxide: "co",
};

export function pollutantGroup(pollutant: string | null | undefined): PollutantGroup | null {
  return pollutant ? (GROUP_OF[pollutant] ?? null) : null;
}

/** Is this profile a sensitive group for the given main pollutant? */
export function isSensitiveFor(profile: Profile, pollutant: string | null | undefined): boolean {
  const g = pollutantGroup(pollutant);
  return g !== null && profile.sensitiveTo.includes(g);
}
