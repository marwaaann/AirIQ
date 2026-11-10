/**
 * Health advice engine: selects rows from lib/health-rules.ts for the current
 * conditions and profile. It never writes free text; the only substitution is
 * {ratio} (PM2.5 ÷ WHO guideline). Pure module (relative imports only).
 */

import { getCategory, POLLUTANT_INFO, type AqiCategory, type PollutantKey } from "./aqi-categories.ts";
import { HEALTH_RULES, type ActivityKind, type HealthRule, type RuleCondition } from "./health-rules.ts";
import { PROFILES, isSensitiveFor, pollutantGroup, type ProfileId } from "./profiles.ts";

export interface AdviceInput {
  /** Overall index on the active scale. */
  aqi: number;
  scale: "us" | "eu";
  /** Main pollutant (from the source's sub-indices). */
  dominant: PollutantKey | null;
  /** Concentrations in µg/m³. */
  pollutants: Partial<Record<PollutantKey, number | null>>;
  profile: ProfileId;
  /** Local hour 0–23 in the city's time zone. */
  localHour: number;
}

export interface Recommendation {
  id: string;
  text: string;
  basis: string;
  priority: number;
}

export interface ActivityGroup {
  kind: ActivityKind;
  label: string;
  items: Recommendation[];
}

export interface AdviceResult {
  category: AqiCategory;
  rank: number;
  sensitive: boolean;
  headline: Recommendation;
  activity: ActivityGroup[];
  indoor: Recommendation[];
  protection: Recommendation[];
  info: Recommendation[];
  /** "Why" line: names the main pollutant and the profile's basis. */
  why: string;
  /** Distinct sources used. */
  bases: string[];
  /** The 3 most important recommendations (excluding the headline). */
  top: Recommendation[];
}

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  walking: "Walking",
  exercise: "Running & exercise",
  commuting: "Commuting",
  children: "Children's outdoor play",
};

const ACTIVITY_ORDER: readonly ActivityKind[] = ["exercise", "walking", "children", "commuting"];

interface Ctx {
  scale: "us" | "eu";
  rank: number;
  sensitive: boolean;
  group: ReturnType<typeof pollutantGroup>;
  profile: ProfileId;
  localHour: number;
  pm25Ratio: number | null;
}

function matches(c: RuleCondition, x: Ctx): boolean {
  if (c.scale && c.scale !== x.scale) return false;
  if (c.ranks && !c.ranks.includes(x.rank)) return false;
  if (c.minRank !== undefined && x.rank < c.minRank) return false;
  if (c.maxRank !== undefined && x.rank > c.maxRank) return false;
  if (c.audience && c.audience !== (x.sensitive ? "sensitive" : "general")) return false;
  if (c.pollutantGroups && (x.group === null || !c.pollutantGroups.includes(x.group))) return false;
  if (c.profiles && !c.profiles.includes(x.profile)) return false;
  if (c.localHours && !(x.localHour >= c.localHours[0] && x.localHour < c.localHours[1])) return false;
  if (c.pm25AboveWho && !(x.pm25Ratio !== null && x.pm25Ratio > 1)) return false;
  return true;
}

function toRec(r: HealthRule, x: Ctx): Recommendation {
  const ratio = x.pm25Ratio === null ? "" : x.pm25Ratio >= 10 ? String(Math.round(x.pm25Ratio)) : x.pm25Ratio.toFixed(1);
  return { id: r.id, text: r.text.replace("{ratio}", ratio), basis: r.basis, priority: r.priority };
}

/** Matching rules for a group (and activity), falling back to `fallback` rows only when nothing else matched. */
function select(x: Ctx, group: HealthRule["group"], activity?: ActivityKind): Recommendation[] {
  const pool = HEALTH_RULES.filter((r) => r.group === group && (activity === undefined || r.activity === activity) && matches(r.when, x));
  const primary = pool.filter((r) => !r.fallback);
  const chosen = primary.length ? primary : pool.filter((r) => r.fallback);
  return chosen.sort((a, b) => a.priority - b.priority).map((r) => toRec(r, x));
}

export function healthAdvice(input: AdviceInput): AdviceResult {
  const category = getCategory(input.aqi, input.scale);
  const profile = PROFILES[input.profile];
  const sensitive = isSensitiveFor(profile, input.dominant);
  const pm25 = input.pollutants.pm2_5;
  const x: Ctx = {
    scale: input.scale,
    rank: category.rank,
    sensitive,
    group: pollutantGroup(input.dominant),
    profile: input.profile,
    localHour: input.localHour,
    pm25Ratio: typeof pm25 === "number" && Number.isFinite(pm25) ? pm25 / POLLUTANT_INFO.pm2_5.who.value : null,
  };

  const headline = select(x, "headline")[0];
  if (!headline) throw new Error(`No headline rule for ${input.scale} rank ${category.rank}`);

  const activity: ActivityGroup[] = ACTIVITY_ORDER.map((kind) => ({ kind, label: ACTIVITY_LABEL[kind], items: select(x, "activity", kind) })).filter(
    (g) => g.items.length > 0,
  );
  const indoor = select(x, "indoor");
  const protection = select(x, "protection");
  const info = select(x, "info");

  const mainName = input.dominant ? POLLUTANT_INFO[input.dominant].short : null;
  const why = mainName
    ? sensitive
      ? `${mainName} is the main pollutant, and ${profile.label.toLowerCase()} is a sensitive group for it. ${profile.basis}`
      : profile.sensitiveTo.length
        ? `${mainName} is the main pollutant. Your profile (${profile.label.toLowerCase()}) is not listed as a sensitive group for ${mainName}, so general-public guidance applies.`
        : `${mainName} is the main pollutant. General-public guidance applies.`
    : "The main pollutant is not reported, so general guidance applies.";

  const all = [headline, ...activity.flatMap((g) => g.items), ...indoor, ...protection, ...info];
  const bases = [...new Set(all.map((r) => r.basis))];

  // Top 3: the most important non-fallback items, one per group where possible.
  const firstOf = (list: Recommendation[]) => list.find((r) => !["commute-ok", "protection-none"].includes(r.id));
  const exercise = activity.find((g) => g.kind === "exercise")?.items[0];
  const candidates = [exercise, firstOf(protection), firstOf(indoor), ...activity.flatMap((g) => g.items)].filter(
    (r): r is Recommendation => r !== undefined,
  );
  const top: Recommendation[] = [];
  for (const r of candidates.sort((a, b) => a.priority - b.priority)) {
    if (!top.some((t) => t.id === r.id || t.text === r.text)) top.push(r);
    if (top.length === 3) break;
  }

  return { category, rank: category.rank, sensitive, headline, activity, indoor, protection, info, why, bases, top };
}
