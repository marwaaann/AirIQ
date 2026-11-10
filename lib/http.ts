import "server-only";
import type { z } from "zod";
import { NextResponse } from "next/server";

import { OpenMeteoErrorSchema } from "@/lib/schemas";
import { cacheHeaders, cached, REVALIDATE_SECONDS } from "@/lib/cache";
import type { ApiError } from "@/types/air";

/** Error raised when an upstream API fails or returns data we cannot validate. */
export class UpstreamError extends Error {
  readonly status: number;
  readonly upstream: string;
  constructor(upstream: string, message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.upstream = upstream;
  }
}

/** Error for invalid client input; becomes HTTP 400. */
export class BadRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

interface FetchJsonOptions<S extends z.ZodType> {
  upstream: string;
  schema: S;
  revalidate?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Key for the in-process cache; defaults to the URL. Never include secrets. */
  cacheKey?: string;
}

/**
 * Fetch JSON from an upstream API, validate with Zod, cache, and turn every
 * failure into an `UpstreamError` with a human-readable message.
 */
export async function fetchJson<S extends z.ZodType>(url: string, opts: FetchJsonOptions<S>): Promise<z.output<S>> {
  const revalidate = opts.revalidate ?? REVALIDATE_SECONDS;
  return cached(opts.cacheKey ?? url, revalidate, async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", ...opts.headers },
        // Never use Next's persistent fetch cache: after an idle period it serves
        // the stale copy first (stale-while-revalidate), which surfaced hours-old
        // readings. Freshness is handled by the in-process TTL cache below.
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      const msg = err instanceof Error && err.name === "TimeoutError" ? "request timed out" : "network error";
      throw new UpstreamError(opts.upstream, `${opts.upstream}: ${msg}`, 504);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError(opts.upstream, `${opts.upstream}: response was not JSON (HTTP ${res.status})`);
    }

    const omError = OpenMeteoErrorSchema.safeParse(body);
    if (omError.success) {
      const status = res.status === 429 ? 429 : res.status === 400 ? 400 : 502;
      throw new UpstreamError(opts.upstream, `${opts.upstream}: ${omError.data.reason}`, status);
    }
    if (!res.ok) {
      throw new UpstreamError(opts.upstream, `${opts.upstream}: HTTP ${res.status}`, res.status === 429 ? 429 : 502);
    }

    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first ? `${first.path.join(".")}: ${first.message}` : "unknown";
      throw new UpstreamError(opts.upstream, `${opts.upstream}: unexpected response shape (${where})`);
    }
    return parsed.data;
  });
}

export function jsonOk<T>(data: T, maxAgeSeconds?: number): NextResponse<T> {
  return NextResponse.json(data, { headers: cacheHeaders(maxAgeSeconds) });
}

export function jsonError(status: number, error: string, detail?: string): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error, ...(detail ? { detail } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Map any thrown error to a JSON error response. */
export function handleRouteError(err: unknown): NextResponse<ApiError> {
  if (err instanceof BadRequestError) return jsonError(400, err.message);
  if (err instanceof UpstreamError) return jsonError(err.status, "Upstream data source unavailable", err.message);
  console.error("[api] unexpected error", err);
  return jsonError(500, "Internal error");
}

/** Validate URLSearchParams against a Zod schema, throwing BadRequestError on failure. */
export function parseQuery<S extends z.ZodType>(params: URLSearchParams, schema: S): z.output<S> {
  const parsed = schema.safeParse(Object.fromEntries(params.entries()));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; ");
    throw new BadRequestError(msg);
  }
  return parsed.data;
}
