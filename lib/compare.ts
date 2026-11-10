/**
 * City comparison helpers: URL state, ranking and the plain-language summary.
 * Every sentence is built from fetched daily means. Pure module.
 */

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;

/** ?cities=slug1,slug2 → unique, non-empty slugs (max 4, order kept). `isValid` filters bad slugs. */
export function parseCitiesParam(raw: string | null, isValid: (slug: string) => boolean = () => true): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim().toLowerCase();
    if (!s || out.includes(s) || !isValid(s)) continue;
    out.push(s);
    if (out.length === MAX_COMPARE) break;
  }
  return out;
}

export function serializeCities(slugs: readonly string[]): string {
  return slugs.slice(0, MAX_COMPARE).join(",");
}

export interface RankInput {
  id: string;
  name: string;
  value: number | null;
}

/** Cleanest (lowest index) first; cities without a value are left out. Ties keep URL order. */
export function rankCleanest<T extends RankInput>(items: readonly T[]): (T & { value: number })[] {
  return items
    .map((it, i) => ({ it, i }))
    .filter((x): x is { it: T & { value: number }; i: number } => x.it.value !== null && Number.isFinite(x.it.value))
    .sort((a, b) => a.it.value - b.it.value || a.i - b.i)
    .map((x) => x.it);
}

export interface DayComparison {
  /** Days where A's rounded daily mean was lower. */
  aCleaner: number;
  bCleaner: number;
  ties: number;
  /** Days with data for both. */
  n: number;
}

/** Compare rounded daily means on the local dates both cities have. */
export function compareDays(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): DayComparison {
  let aCleaner = 0;
  let bCleaner = 0;
  let ties = 0;
  for (const [date, av] of a) {
    const bv = b.get(date);
    if (bv === undefined) continue;
    const ra = Math.round(av);
    const rb = Math.round(bv);
    if (ra < rb) aCleaner++;
    else if (rb < ra) bCleaner++;
    else ties++;
  }
  return { aCleaner, bCleaner, ties, n: aCleaner + bCleaner + ties };
}

export interface SummaryCity {
  name: string;
  /** Local date → daily mean index. */
  days: ReadonlyMap<string, number>;
}

const mean = (m: ReadonlyMap<string, number>) => {
  const v = [...m.values()];
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
};

/**
 * Up to two sentences: the cleanest vs the most polluted city (by period
 * mean) day by day, and each city's period average. Empty when fewer than
 * two cities have data, or they share no days.
 */
export function compareSummary(cities: readonly SummaryCity[], rangeDays: number, unit: string): string[] {
  const withData = cities.map((c) => ({ ...c, avg: mean(c.days) })).filter((c): c is SummaryCity & { avg: number } => c.avg !== null);
  if (withData.length < MIN_COMPARE) return [];
  const sorted = [...withData].sort((a, b) => a.avg - b.avg);
  const clean = sorted[0];
  const dirty = sorted[sorted.length - 1];
  const d = compareDays(clean.days, dirty.days);
  const lines: string[] = [];
  if (d.n > 0) {
    const period = d.n === rangeDays ? `the last ${rangeDays} days` : `the ${d.n} days with data for both in the last ${rangeDays} days`;
    if (d.aCleaner === d.n) lines.push(`${clean.name} has been cleaner than ${dirty.name} on all of ${period}.`);
    else lines.push(`${clean.name} has been cleaner than ${dirty.name} on ${d.aCleaner} of ${period}${d.ties ? ` (${d.ties} tied)` : ""}.`);
  }
  lines.push(`Average daily ${unit} over the last ${rangeDays} days: ${sorted.map((c) => `${c.name} ${Math.round(c.avg)}`).join(", ")}.`);
  return lines;
}
