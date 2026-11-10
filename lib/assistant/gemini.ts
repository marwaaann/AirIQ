/**
 * Gemini adapter (official @google/genai SDK, generateContentStream).
 * Relative imports only, so tests can run it with a mocked HTTP layer.
 */

import { FunctionCallingConfigMode, GoogleGenAI, type Content as GenAIContent, type FunctionDeclaration } from "@google/genai";

import type { ModelClient, Part } from "./loop.ts";
import { UpstreamModelError } from "./loop.ts";
import { FUNCTION_DECLARATIONS } from "./tools.ts";

/** Default model: the current STABLE Flash model per Google's models page (checked 2026-11-10). Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Test hook: point the SDK at a mock server. */
  baseUrl?: string;
  /** Per-request timeout in ms (default 45 000). */
  timeoutMs?: number;
  /** Override retry timing (seconds); tests use tiny delays. */
  retry?: { attempts?: number; initialDelay?: number; maxDelay?: number };
}

/**
 * Transient upstream failures (overloaded 503, other 5xx, 408) are retried by
 * the SDK with exponential backoff before any output is streamed (seen live on
 * 2026-11-10: 3 × 503 "model overloaded" in 7 questions). 429 is NOT retried:
 * on the free tier it is a daily per-model quota (20 requests/day for
 * gemini-3.6-flash), so retrying only burns requests.
 */
const RETRYABLE = [408, 500, 502, 503, 504];

const declarations: FunctionDeclaration[] = FUNCTION_DECLARATIONS.map((d) => ({
  name: d.name,
  description: d.description,
  parametersJsonSchema: d.parametersJsonSchema,
}));

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object") {
    const s = (err as { status?: unknown; code?: unknown }).status ?? (err as { code?: unknown }).code;
    if (typeof s === "number") return s;
  }
  return null;
}

/** Short cause description for server logs only, with anything key-like redacted. */
export function causeSummary(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const msg = err.message.replace(/AIza[\w-]{20,}|AQ\.[\w.-]{20,}|key=[^&\s]+/g, "[redacted]").slice(0, 160);
  return `${err.name}: ${msg}`;
}

export function createGeminiClient(opts: GeminiOptions): ModelClient {
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: {
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      // A stalled stream fails after 45 s instead of hanging the chat (seen live: one 3-minute hang).
      timeout: opts.timeoutMs ?? 45_000,
      retryOptions: {
        attempts: opts.retry?.attempts ?? 3,
        initialDelay: opts.retry?.initialDelay ?? 1,
        maxDelay: opts.retry?.maxDelay ?? 6,
        httpStatusCodes: RETRYABLE,
      },
    },
  });
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  return {
    async *stream(req) {
      let iter: AsyncGenerator<{ candidates?: { content?: { parts?: Part[] } }[] }>;
      try {
        iter = await ai.models.generateContentStream({
          model,
          contents: req.contents as GenAIContent[],
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxOutputTokens,
            temperature: 0.2,
            tools: [{ functionDeclarations: declarations }],
            toolConfig: {
              functionCallingConfig: { mode: req.toolMode === "NONE" ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO },
            },
            abortSignal: req.signal,
          },
        });
      } catch (err) {
        if (req.signal.aborted) return;
        throw new UpstreamModelError("model request failed", statusOf(err), causeSummary(err));
      }
      try {
        for await (const chunk of iter) {
          yield { parts: (chunk.candidates?.[0]?.content?.parts ?? []) as Part[] };
        }
      } catch (err) {
        if (req.signal.aborted) return;
        throw new UpstreamModelError("model stream failed", statusOf(err), causeSummary(err));
      }
    },
  };
}

