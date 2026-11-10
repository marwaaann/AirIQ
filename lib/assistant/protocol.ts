/**
 * Request validation and the Server-Sent Events protocol shared by the
 * /api/assistant route and the chat UI. Pure module.
 */

import { z } from "zod";

import { PROFILE_IDS } from "../profiles.ts";

export const MAX_MESSAGES = 20;
export const MAX_USER_CHARS = 2000;
export const MAX_ASSISTANT_CHARS = 8000;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatContextSchema = z.object({
  city: z.string().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  profile: z.enum(PROFILE_IDS).optional(),
  scale: z.enum(["us", "eu"]).optional(),
});
export type ChatContext = z.infer<typeof ChatContextSchema>;

export const AssistantRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
    context: ChatContextSchema.optional(),
  })
  .superRefine((req, ctx) => {
    req.messages.forEach((m, i) => {
      const limit = m.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
      if (m.content.length > limit) {
        ctx.addIssue({ code: "custom", path: ["messages", i, "content"], message: `${m.role} message longer than ${limit} characters` });
      }
    });
    const last = req.messages[req.messages.length - 1];
    if (!last || last.role !== "user" || last.content.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["messages"], message: "the last message must be a non-empty user message" });
    }
  });
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;

/* ------------------------------------------------------------------------- */
/* Events                                                                     */
/* ------------------------------------------------------------------------- */

export type AssistantEvent =
  | { type: "safety"; message: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; keyValues: Record<string, string | number | null> }
  | { type: "retry"; unsupported: string[] }
  | { type: "notice"; message: string }
  | { type: "done"; rounds: number; grounding: { checked: number; unsupported: string[] } }
  | { type: "error"; code: string; message: string };

export function encodeSse(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Incremental SSE parser: returns complete events and the unconsumed remainder. */
export function parseSse(buffer: string): { events: AssistantEvent[]; rest: string } {
  const events: AssistantEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AssistantEvent);
    } catch {
      // Ignore malformed frames.
    }
  }
  return { events, rest };
}
