/**
 * Sliding-window rate limiter for upstream APIs (OpenAQ's free tier allows
 * 60 requests a minute). `acquire()` resolves when a request may start, or
 * rejects when the wait would exceed `maxWaitMs`, so a page never hangs for
 * a minute: the caller treats that station as unavailable instead.
 *
 * Pure module (no imports) so it runs under `node --test`; time and sleep are
 * injectable.
 */

export class RateLimitWaitError extends Error {
  constructor(waitMs: number) {
    super(`rate limit: next slot in ${Math.ceil(waitMs / 1000)} s`);
    this.name = "RateLimitWaitError";
  }
}

export interface SlidingLimiterOptions {
  limit: number;
  windowMs: number;
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class SlidingLimiter {
  private readonly starts: number[] = [];
  private blockedUntil = 0;
  private readonly o: Required<SlidingLimiterOptions>;

  constructor(opts: SlidingLimiterOptions) {
    this.o = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
    };
  }

  /** Requests started in the current window. */
  used(): number {
    this.prune();
    return this.starts.length;
  }

  /** Stop all requests for `ms` (after an HTTP 429). */
  backoff(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.o.now() + ms);
  }

  private prune(): void {
    const cutoff = this.o.now() - this.o.windowMs;
    while (this.starts.length && this.starts[0] <= cutoff) this.starts.shift();
  }

  /** Milliseconds until a slot is free (0 = now). */
  waitTime(): number {
    this.prune();
    const now = this.o.now();
    const blocked = Math.max(0, this.blockedUntil - now);
    if (this.starts.length < this.o.limit) return blocked;
    // The slot frees when the oldest request that still blocks us leaves the window.
    const oldest = this.starts[this.starts.length - this.o.limit];
    return Math.max(blocked, oldest + this.o.windowMs - now);
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const wait = this.waitTime();
      if (wait === 0) {
        this.starts.push(this.o.now());
        return;
      }
      if (wait > this.o.maxWaitMs) throw new RateLimitWaitError(wait);
      await this.o.sleep(Math.min(wait, 1000));
    }
  }
}
