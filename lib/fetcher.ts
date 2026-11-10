/** Client-side fetcher for the app's own /api routes (used with SWR). */

import { parseStaleHeaders, type WithMeta } from "./stale.ts";

export class ApiClientError extends Error {
  readonly status: number;
  readonly detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.detail = detail;
  }
}

function isErrorBody(v: unknown): v is { error: string; detail?: string } {
  return typeof v === "object" && v !== null && "error" in v && typeof (v as { error: unknown }).error === "string";
}

/** Status used for requests cancelled by an AbortSignal (not a real failure). */
export const ABORTED_STATUS = -1;

/**
 * GET one of AirIQ's API routes. Every object body gets `_meta` (see lib/stale.ts):
 * whether the service worker served it from its offline cache, and from when.
 * It is a regular (enumerable) field so SWR's deep compare notices a switch
 * between a fresh and a stale copy of identical data.
 */
export async function apiFetch<T>(url: string, signal?: AbortSignal): Promise<T & WithMeta> {
  let res: Response;
  try {
    // no-store: never let the browser HTTP cache answer (it could hand back old data that is
    // not labelled stale). Freshness caching happens on the server; offline copies come only
    // from the service worker, which marks them.
    res = await fetch(url, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new ApiClientError("Request cancelled", ABORTED_STATUS);
    }
    throw new ApiClientError("Network error. Check your connection.", 0);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError(`Unexpected response (HTTP ${res.status})`, res.status);
  }
  if (!res.ok || isErrorBody(body)) {
    if (isErrorBody(body)) throw new ApiClientError(body.error, res.status, body.detail);
    throw new ApiClientError(`Request failed (HTTP ${res.status})`, res.status);
  }
  const meta = parseStaleHeaders(res.headers);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body as T & WithMeta;
  return { ...(body as T), _meta: meta };
}

/** Human-readable error message for UI error states. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.detail ? `${err.message}: ${err.detail}` : err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
