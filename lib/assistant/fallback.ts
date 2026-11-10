/**
 * Quota fallback for the assistant's model client, plus model-name resolution.
 * Pure module (relative imports only).
 */

import { UpstreamModelError, type ModelClient } from "./loop.ts";

/** Default primary model: current STABLE Flash model (Google models page, checked 2026-11-10). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
/**
 * Default fallback: current STABLE lite model (Google models page, and confirmed
 * with models.get on 2026-11-10: models/gemini-3.5-flash-lite, version 3.5-flash-lite-07-2026).
 * Free-tier quotas are per model, so a quota-exhausted primary can still be answered here.
 */
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

export interface ModelChoice {
  primary: string;
  /** null = no fallback (disabled, or identical to the primary). */
  fallback: string | null;
}

/**
 * GEMINI_MODEL / GEMINI_FALLBACK_MODEL: empty or whitespace-only means unset
 * (use the default). GEMINI_FALLBACK_MODEL=off (or "none") disables the fallback.
 */
export function resolveModels(env: { GEMINI_MODEL?: string; GEMINI_FALLBACK_MODEL?: string }): ModelChoice {
  const primary = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const raw = env.GEMINI_FALLBACK_MODEL?.trim() ?? "";
  if (/^(off|none)$/i.test(raw)) return { primary, fallback: null };
  const fallback = raw || DEFAULT_FALLBACK_MODEL;
  return { primary, fallback: fallback === primary ? null : fallback };
}

/** True for the upstream error that means "quota / rate limit exhausted". */
export function isQuotaError(err: unknown): boolean {
  return err instanceof UpstreamModelError && err.status === 429;
}

/**
 * Wrap a primary client so that a quota 429 raised BEFORE any output was
 * streamed retries that request once on the fallback client. Once switched,
 * the rest of the turn stays on the fallback (sticky), and `onSwitch` is
 * called exactly once. If the fallback also hits its quota, its 429 error is
 * thrown unchanged, so the caller shows the usual usage-limit message.
 */
export function withQuotaFallback(primary: ModelClient, fallback: ModelClient | null, onSwitch: () => void): ModelClient {
  let switched = false;
  return {
    async *stream(req) {
      if (!switched) {
        let yielded = false;
        try {
          for await (const chunk of primary.stream(req)) {
            yielded = true;
            yield chunk;
          }
          return;
        } catch (err) {
          if (!fallback || yielded || !isQuotaError(err) || req.signal.aborted) throw err;
          switched = true;
          onSwitch();
        }
      }
      if (!fallback) return;
      yield* fallback.stream(req);
    },
  };
}
