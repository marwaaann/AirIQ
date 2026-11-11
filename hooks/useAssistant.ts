"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { z } from "@/lib/zod";

import { lenientArray } from "@/lib/alerts";
import { MAX_MESSAGES, MAX_USER_CHARS, parseSse, type AssistantEvent, type ChatContext } from "@/lib/assistant/protocol";
import { apiFetch } from "@/lib/fetcher";
import { createStoredValue, useStoredValue, type StoredValue } from "@/lib/storage";

/* ------------------------------------------------------------------------- */
/* Persisted transcript (sessionStorage, validated, capped)                    */
/* ------------------------------------------------------------------------- */

const ToolChipSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  ok: z.boolean().nullable(),
  summary: z.string().nullable(),
  keyValues: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});
export type ToolChip = z.infer<typeof ToolChipSchema>;

const ChatEntrySchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12_000),
  safety: z.string().optional(),
  tools: z.array(ToolChipSchema).max(40),
  notices: z.array(z.string()).max(6),
  status: z.enum(["streaming", "done", "stopped", "error"]),
  error: z.string().optional(),
  rechecked: z.boolean().optional(),
  /** Set when the primary model hit its quota and the backup model answered. */
  backupModel: z.string().max(80).optional(),
});
export type ChatEntry = z.infer<typeof ChatEntrySchema>;

const MAX_ENTRIES = 40;
const stores = new Map<string, StoredValue<ChatEntry[]>>();
const EMPTY: ChatEntry[] = [];
function storeFor(chatId: string) {
  let s = stores.get(chatId);
  if (!s) {
    s = createStoredValue(`airiq:chat:${chatId}`, lenientArray(ChatEntrySchema, MAX_ENTRIES), EMPTY, "session");
    stores.set(chatId, s);
  }
  return s;
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------------- */

export type AssistantConfig = { configured: boolean; model: string; fallbackModel: string | null };

function applyEvent(e: ChatEntry, ev: AssistantEvent): ChatEntry {
  switch (ev.type) {
    case "safety":
      return { ...e, safety: ev.message };
    case "text":
      return { ...e, content: e.content + ev.delta };
    case "tool_start":
      return { ...e, tools: [...e.tools, { id: ev.id, name: ev.name, args: ev.args, ok: null, summary: null, keyValues: {} }].slice(-40) };
    case "tool_result":
      return {
        ...e,
        tools: e.tools.map((t) => (t.id === ev.id && t.ok === null ? { ...t, ok: ev.ok, summary: ev.summary, keyValues: ev.keyValues } : t)),
      };
    case "retry":
      // The answer is being regenerated after the numeric check: drop the first draft.
      return { ...e, content: "", rechecked: true };
    case "model_fallback":
      return { ...e, backupModel: ev.model };
    case "notice":
      return { ...e, notices: [...e.notices, ev.message].slice(-6) };
    case "done":
      return { ...e, status: "done" };
    case "error":
      return { ...e, status: "error", error: ev.message };
  }
}

export function useAssistant(chatId: string, context?: ChatContext) {
  const store = storeFor(chatId);
  const [entries] = useStoredValue(store);
  const { data: config, error: configError, mutate: refreshConfig } = useSWR<AssistantConfig, Error>("/api/assistant", apiFetch, {
    revalidateOnFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // A reload during streaming leaves "streaming" entries behind: mark them stopped.
  useEffect(() => {
    if (!busy && entries.some((e) => e.status === "streaming")) {
      store.set((prev) => prev.map((e) => (e.status === "streaming" ? { ...e, status: "stopped" } : e)));
    }
  }, [busy, entries, store]);

  const update = useCallback((id: string, fn: (e: ChatEntry) => ChatEntry) => store.set((prev) => prev.map((e) => (e.id === id ? fn(e) : e))), [store]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_USER_CHARS);
      if (!text || busy) return;
      if (rateLimitedUntil && Date.now() < rateLimitedUntil) return;
      const userEntry: ChatEntry = { id: uid(), role: "user", content: text, tools: [], notices: [], status: "done" };
      const aid = uid();
      const assistantEntry: ChatEntry = { id: aid, role: "assistant", content: "", tools: [], notices: [], status: "streaming" };

      // History: completed turns only, last MAX_MESSAGES, starting with a user turn.
      const prior = store
        .get()
        .filter((e) => e.content.trim() && (e.role === "user" || e.status === "done" || e.status === "stopped"))
        .map((e) => ({ role: e.role, content: e.content.slice(0, e.role === "user" ? MAX_USER_CHARS : 8000) }));
      let history = [...prior, { role: "user" as const, content: text }].slice(-MAX_MESSAGES);
      while (history.length && history[0].role !== "user") history = history.slice(1);

      store.set((prev) => [...prev, userEntry, assistantEntry].slice(-MAX_ENTRIES));
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, context: contextRef.current }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let message = `Request failed (HTTP ${res.status}).`;
          try {
            const body = (await res.json()) as { message?: string; retryAfterSec?: number };
            if (body.message) message = body.message;
          } catch {
            // Non-JSON error body.
          }
          if (res.status === 429) {
            const after = Number(res.headers.get("Retry-After")) || 60;
            setRateLimitedUntil(Date.now() + after * 1000);
          }
          if (res.status === 503) void refreshConfig();
          update(aid, (e) => ({ ...e, status: "error", error: message }));
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no body");
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSse(buffer);
          buffer = rest;
          for (const ev of events) {
            update(aid, (e) => applyEvent(e, ev));
            if (ev.type === "done" || ev.type === "error") finished = true;
          }
        }
        if (!finished) update(aid, (e) => (e.status === "streaming" ? { ...e, status: "error", error: "The connection closed before the answer finished." } : e));
        const final = store.get().find((e) => e.id === aid);
        if (final?.status === "done") setAnnouncement(`AirIQ answered: ${final.content.replace(/[*_#`]/g, "").slice(0, 400)}`);
      } catch {
        if (ctrl.signal.aborted) update(aid, (e) => ({ ...e, status: "stopped" }));
        else update(aid, (e) => ({ ...e, status: "error", error: navigator.onLine ? "Network error. Check your connection and try again." : "The assistant needs a connection." }));
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, rateLimitedUntil, store, update, refreshConfig],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    store.set([]);
    setAnnouncement("Chat cleared.");
  }, [store]);

  /** Re-send the user message that produced a failed/stopped answer. */
  const retry = useCallback(
    (assistantId: string) => {
      const list = store.get();
      const idx = list.findIndex((e) => e.id === assistantId);
      const user = idx > 0 ? list[idx - 1] : null;
      if (!user || user.role !== "user") return;
      store.set(list.filter((e) => e.id !== assistantId && e.id !== user.id));
      void send(user.content);
    },
    [store, send],
  );

  return {
    entries: entries ?? EMPTY,
    config,
    configError,
    busy,
    rateLimitedUntil,
    clearRateLimit: () => setRateLimitedUntil(null),
    announcement,
    send,
    stop,
    clear,
    retry,
  };
}
