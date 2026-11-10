import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { liveDataLayer } from "@/lib/assistant/data-layer";
import { resolveModels, withQuotaFallback } from "@/lib/assistant/fallback";
import { createGeminiClient } from "@/lib/assistant/gemini";
import { runAssistant, UpstreamModelError } from "@/lib/assistant/loop";
import { AssistantRequestSchema, encodeSse, type AssistantEvent } from "@/lib/assistant/protocol";
import { RateLimiter } from "@/lib/assistant/rate-limit";
import { runTool } from "@/lib/assistant/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 20 requests per 10 minutes per IP. In-memory: per server instance only. */
const limiter = new RateLimiter(20, 10 * 60 * 1000);

function apiKey(): string | null {
  const k = process.env.GEMINI_API_KEY?.trim();
  return k ? k : null;
}

function models() {
  return resolveModels({ GEMINI_MODEL: process.env.GEMINI_MODEL, GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL });
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim() || "local";
}

const noStore = { "Cache-Control": "no-store" };

/** GET /api/assistant → whether the assistant is configured (never reveals the key). */
export async function GET() {
  const m = models();
  return NextResponse.json({ configured: apiKey() !== null, model: m.primary, fallbackModel: m.fallback }, { headers: noStore });
}

/** POST /api/assistant { messages, context? } → text/event-stream of AssistantEvent frames. */
export async function POST(req: NextRequest) {
  const key = apiKey();
  if (!key) {
    return NextResponse.json(
      { error: "not_configured", message: "The assistant is not configured: set GEMINI_API_KEY in .env.local and restart the server." },
      { status: 503, headers: noStore },
    );
  }

  const rate = limiter.check(clientIp(req));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: `Too many requests. Try again in ${rate.retryAfterSec} s.`, retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { ...noStore, "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Body must be JSON." }, { status: 400, headers: noStore });
  }
  const parsed = AssistantRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: "bad_request", message }, { status: 400, headers: noStore });
  }

  const m = models();
  const baseUrl = process.env.GEMINI_BASE_URL?.trim() || undefined;
  const primary = createGeminiClient({ apiKey: key, model: m.primary, baseUrl });
  const fallback = m.fallback ? createGeminiClient({ apiKey: key, model: m.fallback, baseUrl }) : null;
  const upstream = new AbortController();
  // A client disconnect / Stop cancels the upstream model request and the loop.
  req.signal.addEventListener("abort", () => upstream.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: AssistantEvent) => {
        if (closed || upstream.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          closed = true;
        }
      };
      // Quota 429 on the primary model → retry once on the backup model (and tell the UI).
      const client = withQuotaFallback(primary, fallback, () => emit({ type: "model_fallback", model: m.fallback ?? "" }));
      try {
        await runAssistant({
          client,
          messages: parsed.data.messages,
          context: parsed.data.context,
          executeTool: (name, args) => runTool(name, args, liveDataLayer),
          emit,
          signal: upstream.signal,
        });
      } catch (err) {
        if (!upstream.signal.aborted) {
          const status = err instanceof UpstreamModelError ? err.status : null;
          // Log only non-sensitive facts; never the key or raw provider messages.
          console.error("[assistant] upstream failure", {
            status,
            phase: err instanceof Error ? err.message : "unknown",
            cause: err instanceof UpstreamModelError ? err.causeSummary : err instanceof Error ? err.name : typeof err,
          });
          emit({
            type: "error",
            code: status === 429 ? "upstream_busy" : "upstream",
            message:
              status === 429
                ? "The AI service's usage limit has been reached. Please try again later."
                : "The AI service could not answer right now. Please try again.",
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
