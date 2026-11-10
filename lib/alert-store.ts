"use client";

import {
  EventsStorageSchema,
  RulesStorageSchema,
  RuleStatesStorageSchema,
  type AlertEvent,
  type AlertRule,
  type RuleState,
} from "@/lib/alerts";
import { createStoredValue } from "@/lib/storage";

/**
 * Persisted alert data. Every read is validated (lib/alerts.ts schemas);
 * malformed items are dropped and corrupted entries discarded (lib/storage.ts).
 */
export const rulesStore = createStoredValue<AlertRule[]>("airiq:alert-rules", RulesStorageSchema, []);
export const ruleStatesStore = createStoredValue<Record<string, RuleState>>("airiq:alert-state", RuleStatesStorageSchema, {});
export const eventsStore = createStoredValue<AlertEvent[]>("airiq:alert-events", EventsStorageSchema, []);

/** Ask the runtime (mounted in the layout) to re-fetch and re-evaluate now. */
export const CHECK_ALERTS_EVENT = "airiq:check-alerts";
export function requestAlertCheck(): void {
  window.dispatchEvent(new Event(CHECK_ALERTS_EVENT));
}

export function newRuleId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
