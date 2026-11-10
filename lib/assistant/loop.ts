/**
 * Server-side assistant loop: stream the model, run requested tools in
 * parallel, feed results back, repeat (max 6 tool rounds), then check the
 * final answer's numbers against this turn's tool results and retry once if
 * any are unsupported. The model client and tool executor are injected, so
 * tests can mock both. Pure module (relative imports only).
 */

import { checkGrounding } from "./grounding-check.ts";
import type { AssistantEvent, ChatContext, ChatMessage } from "./protocol.ts";
import { contextPreamble, detectEmergency, retryInstruction, SAFETY_MESSAGE, SYSTEM_PROMPT, UNSUPPORTED_NOTICE } from "./system-prompt.ts";
import type { ToolOutcome } from "./tools.ts";

export const MAX_TOOL_ROUNDS = 6;
export const MAX_OUTPUT_TOKENS = 1024;

/** Minimal mirror of the Gemini content types we use. */
export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
}
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface ModelRequest {
  contents: Content[];
  system: string;
  maxOutputTokens: number;
  /** "NONE" forbids tool calls (used after the round cap). */
  toolMode: "AUTO" | "NONE";
  signal: AbortSignal;
}

export interface ModelClient {
  stream(req: ModelRequest): AsyncIterable<{ parts: Part[] }>;
}

export class UpstreamModelError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "UpstreamModelError";
    this.status = status;
  }
}

export interface RunOptions {
  client: ModelClient;
  messages: readonly ChatMessage[];
  context?: ChatContext;
  executeTool: (name: string, args: unknown) => Promise<ToolOutcome>;
  emit: (event: AssistantEvent) => void;
  signal: AbortSignal;
  maxRounds?: number;
  maxOutputTokens?: number;
}

function toContents(messages: readonly ChatMessage[], context: ChatContext | undefined): Content[] {
  const contents: Content[] = messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  const pre = contextPreamble(context);
  if (pre) {
    const last = contents[contents.length - 1];
    last.parts = [{ text: pre }, ...last.parts];
  }
  return contents;
}

export async function runAssistant(o: RunOptions): Promise<void> {
  const maxRounds = o.maxRounds ?? MAX_TOOL_ROUNDS;
  const maxOutputTokens = o.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const userText = o.messages[o.messages.length - 1]?.content ?? "";
  const contents = toContents(o.messages, o.context);

  // Deterministic safety message, independent of the model.
  if (detectEmergency(userText)) o.emit({ type: "safety", message: SAFETY_MESSAGE });

  const toolResults: unknown[] = [];
  let toolRounds = 0;
  let retried = false;
  let visible = "";
  let callSeq = 0;

  while (true) {
    if (o.signal.aborted) return;
    const capped = toolRounds >= maxRounds;
    const parts: Part[] = [];
    for await (const chunk of o.client.stream({
      contents,
      system: SYSTEM_PROMPT,
      maxOutputTokens,
      toolMode: capped ? "NONE" : "AUTO",
      signal: o.signal,
    })) {
      for (const p of chunk.parts) {
        parts.push(p);
        if (typeof p.text === "string" && p.text && !p.thought) {
          visible += p.text;
          o.emit({ type: "text", delta: p.text });
        }
      }
    }
    if (o.signal.aborted) return;
    // Keep the model turn exactly as received (incl. thought signatures).
    contents.push({ role: "model", parts });

    const calls = parts.filter((p) => p.functionCall?.name);
    if (calls.length > 0 && !capped) {
      toolRounds++;
      const started = calls.map((p) => {
        const id = p.functionCall?.id ?? `call-${++callSeq}`;
        const name = p.functionCall?.name as string;
        const args = p.functionCall?.args ?? {};
        o.emit({ type: "tool_start", id, name, args });
        return { id, name, args, callId: p.functionCall?.id };
      });
      // Independent calls run in parallel.
      const outcomes = await Promise.all(started.map((c) => o.executeTool(c.name, c.args)));
      if (o.signal.aborted) return;
      outcomes.forEach((out, i) => {
        const c = started[i];
        o.emit({ type: "tool_result", id: c.id, name: c.name, ok: out.ok, summary: out.summary, keyValues: out.keyValues });
        toolResults.push(out.result);
      });
      contents.push({
        role: "user",
        parts: started.map((c, i) => ({
          functionResponse: {
            ...(c.callId ? { id: c.callId } : {}),
            name: c.name,
            response: outcomes[i].ok ? { output: outcomes[i].result } : { error: outcomes[i].result },
          },
        })),
      });
      continue;
    }

    if (capped) {
      o.emit({ type: "notice", message: `Stopped after ${maxRounds} rounds of data fetching; this answer may be incomplete.` });
    }

    // Numeric grounding guard (best effort, never blocks the answer).
    const g = checkGrounding(visible, toolResults, userText);
    if (g.unsupported.length > 0 && !retried) {
      retried = true;
      o.emit({ type: "retry", unsupported: g.unsupported });
      visible = "";
      contents.push({ role: "user", parts: [{ text: retryInstruction(g.unsupported) }] });
      continue;
    }
    if (g.unsupported.length > 0) o.emit({ type: "notice", message: UNSUPPORTED_NOTICE });
    if (!visible.trim()) o.emit({ type: "notice", message: "The assistant did not return an answer. Please try rephrasing." });
    o.emit({ type: "done", rounds: toolRounds, grounding: g });
    return;
  }
}
