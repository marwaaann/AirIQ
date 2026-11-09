/** Client-side fetcher for the app's own /api routes (used with SWR). */

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

export async function apiFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal });
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
  return body as T;
}

/** Human-readable error message for UI error states. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.detail ? `${err.message}: ${err.detail}` : err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
