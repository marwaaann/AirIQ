/**
 * In-memory sliding-window rate limiter (per key, e.g. client IP).
 * Per server instance only: not suitable for multi-instance production.
 * Pure module.
 */

export type RateResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly maxKeys: number;
  private hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  check(key: string, now: number = Date.now()): RateResult {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000)) };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { ok: true, remaining: this.limit - list.length };
  }

  private prune(now: number) {
    const since = now - this.windowMs;
    for (const [k, v] of this.hits) if (!v.some((t) => t > since)) this.hits.delete(k);
  }
}
