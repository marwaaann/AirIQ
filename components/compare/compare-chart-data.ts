// Chart data shapes for the compare view. No Recharts import, so CompareView
// can build rows without loading the chart library.
import { formatLocalDate } from "@/lib/format";

export interface ChartSeries {
  key: string;
  name: string;
  /** Index into the fixed series palette (stable per URL slot, never by rank). */
  slot: number;
}

export type ChartRow = Record<string, number | string | null> & { x: string | number; label: string };

export function dateLabel(date: string, many: boolean): string {
  return formatLocalDate(date, many ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" });
}
