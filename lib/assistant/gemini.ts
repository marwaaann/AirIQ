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
}

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

export function createGeminiClient(opts: GeminiOptions): ModelClient {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}) });
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
        throw new UpstreamModelError("model request failed", statusOf(err));
      }
      try {
        for await (const chunk of iter) {
          yield { parts: (chunk.candidates?.[0]?.content?.parts ?? []) as Part[] };
        }
      } catch (err) {
        if (req.signal.aborted) return;
        throw new UpstreamModelError("model stream failed", statusOf(err));
      }
    },
  };
}

