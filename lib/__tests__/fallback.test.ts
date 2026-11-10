import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_FALLBACK_MODEL, DEFAULT_GEMINI_MODEL, resolveModels, withQuotaFallback } from "../assistant/fallback.ts";
import { createGeminiClient } from "../assistant/gemini.ts";
import { runAssistant } from "../assistant/loop.ts";
import type { AssistantEvent } from "../assistant/protocol.ts";
import type { ToolOutcome } from "../assistant/tools.ts";

const noTools = async (): Promise<ToolOutcome> => ({ ok: true, result: { status: "ok" }, summary: "", keyValues: {} });
const sse = (text: string) => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] })}\r\n\r\n`));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
};
const quota = () =>
  new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota" } }), { status: 429 });

/** Mock Google's HTTP layer; `respond(model)` decides each response by the model in the URL. */
function mockHttp(respond: (model: string) => Response) {
  const models: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const m = /models\/([^:]+):/.exec(String(url))?.[1] ?? "?";
    models.push(m);
    return respond(m);
  }) as typeof fetch;
  return { models, restore: () => (globalThis.fetch = original) };
}

async function ask(respond: (model: string) => Response, fallbackModel: string | null = "lite-model") {
  const http = mockHttp(respond);
  const events: AssistantEvent[] = [];
  const opts = { apiKey: "k", baseUrl: "http://mock.gemini", retry: { attempts: 3, initialDelay: 0.01, maxDelay: 0.02 } };
  const client = withQuotaFallback(
    createGeminiClient({ ...opts, model: "main-model" }),
    fallbackModel ? createGeminiClient({ ...opts, model: fallbackModel }) : null,
    () => events.push({ type: "model_fallback", model: fallbackModel ?? "" }),
  );
  let error: unknown = null;
  try {
    await runAssistant({ client, messages: [{ role: "user", content: "hi" }], executeTool: noTools, emit: (e) => events.push(e), signal: new AbortController().signal });
  } catch (e) {
    error = e;
  } finally {
    http.restore();
  }
  return { events, models: http.models, error };
}

describe("model resolution", () => {
  it("treats empty or whitespace env values as unset", () => {
    assert.deepEqual(resolveModels({}), { primary: DEFAULT_GEMINI_MODEL, fallback: DEFAULT_FALLBACK_MODEL });
    assert.deepEqual(resolveModels({ GEMINI_MODEL: "  ", GEMINI_FALLBACK_MODEL: " \t " }), { primary: DEFAULT_GEMINI_MODEL, fallback: DEFAULT_FALLBACK_MODEL });
    assert.deepEqual(resolveModels({ GEMINI_MODEL: " a ", GEMINI_FALLBACK_MODEL: " b " }), { primary: "a", fallback: "b" });
  });
  it("disables the fallback with off/none or when it equals the primary", () => {
    assert.equal(resolveModels({ GEMINI_FALLBACK_MODEL: "off" }).fallback, null);
    assert.equal(resolveModels({ GEMINI_FALLBACK_MODEL: "NONE" }).fallback, null);
    assert.equal(resolveModels({ GEMINI_MODEL: "x", GEMINI_FALLBACK_MODEL: "x" }).fallback, null);
  });
  it("defaults are the verified stable models", () => {
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.6-flash");
    assert.equal(DEFAULT_FALLBACK_MODEL, "gemini-3.5-flash-lite");
  });
});

describe("quota fallback (mocked Gemini HTTP)", () => {
  it("retries once on the fallback model when the primary returns a quota 429", async () => {
    const r = await ask((m) => (m === "main-model" ? quota() : sse("Answer from backup.")));
    assert.deepEqual(r.models, ["main-model", "lite-model"]);
    assert.equal(r.error, null);
    assert.deepEqual(
      r.events.map((e) => e.type),
      ["model_fallback", "text", "done"],
    );
    assert.deepEqual(r.events[0], { type: "model_fallback", model: "lite-model" });
  });

  it("surfaces the 429 when both models hit their quota (one fallback attempt only)", async () => {
    const r = await ask(() => quota());
    assert.deepEqual(r.models, ["main-model", "lite-model"]);
    assert.ok(r.error && (r.error as { status?: number }).status === 429);
    assert.equal(r.events.filter((e) => e.type === "model_fallback").length, 1);
  });

  it("does not fall back for non-quota errors (503 is retried on the same model instead)", async () => {
    let n = 0;
    const r = await ask((m) => (m === "main-model" && n++ < 1 ? new Response("{}", { status: 503 }) : sse("Recovered on main.")));
    assert.deepEqual(r.models, ["main-model", "main-model"]);
    assert.equal(r.events.some((e) => e.type === "model_fallback"), false);
    assert.equal(r.events.at(-1)?.type, "done");
  });

  it("without a fallback model the quota error is surfaced directly", async () => {
    const r = await ask(() => quota(), null);
    assert.deepEqual(r.models, ["main-model"]);
    assert.ok(r.error && (r.error as { status?: number }).status === 429);
  });

  it("stays on the fallback for the rest of the turn once switched", async () => {
    let call = 0;
    const http = mockHttp((m) => {
      call++;
      if (m === "main-model") return quota();
      if (call === 2) {
        const enc = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "x", name: "resolve_city", args: { query: "Delhi" } } }] } }] })}\r\n\r\n`),
              );
              c.close();
            },
          }),
          { status: 200 },
        );
      }
      return sse("Done.");
    });
    const opts = { apiKey: "k", baseUrl: "http://mock.gemini", retry: { attempts: 1 } };
    let switches = 0;
    const client = withQuotaFallback(createGeminiClient({ ...opts, model: "main-model" }), createGeminiClient({ ...opts, model: "lite-model" }), () => switches++);
    try {
      await runAssistant({ client, messages: [{ role: "user", content: "hi" }], executeTool: noTools, emit: () => {}, signal: new AbortController().signal });
    } finally {
      http.restore();
    }
    assert.deepEqual(http.models, ["main-model", "lite-model", "lite-model"]);
    assert.equal(switches, 1);
  });
});
