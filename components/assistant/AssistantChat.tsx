"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";

import { DataUsed } from "@/components/assistant/DataUsed";
import { Markdown } from "@/components/assistant/Markdown";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import { useAssistant, type ChatEntry } from "@/hooks/useAssistant";
import { useNow } from "@/hooks/useNow";
import { MAX_USER_CHARS, type ChatContext } from "@/lib/assistant/protocol";

export const QUICK_PROMPTS = [
  "Is it safe to run outdoors today?",
  "Best time to open windows tomorrow?",
  "Compare Delhi and Mumbai",
  "Why is the air bad this week?",
] as const;

export interface AssistantChatHandle {
  focusInput: () => void;
}

function NotConfigured({ model }: { model?: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4 text-sm" data-testid="assistant-not-configured">
      <p className="font-semibold">Assistant not configured</p>
      <p>
        The AI assistant needs a Google Gemini API key. Add <code className="rounded bg-surface px-1 font-mono">GEMINI_API_KEY=…</code> to{" "}
        <code className="rounded bg-surface px-1 font-mono">.env.local</code> in the project folder (see <code className="font-mono">.env.example</code>) and
        restart the server. A free key is available from Google AI Studio.
      </p>
      <p className="text-muted">
        Everything else in AirIQ (dashboard, map, history, forecast, health advice and alerts) works without it.
        {model ? ` Default model: ${model}.` : ""}
      </p>
    </div>
  );
}

function Message({ e, onRetry }: { e: ChatEntry; onRetry: () => void }) {
  if (e.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-text px-3 py-2 text-sm text-bg">{e.content}</p>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2" data-testid="assistant-message" data-status={e.status}>
      {e.safety ? (
        <p role="alert" className="rounded-xl border border-danger/60 bg-danger/10 p-3 text-sm font-semibold text-danger" data-testid="safety-message">
          {e.safety}
        </p>
      ) : null}
      <DataUsed tools={e.tools} />
      {e.content ? (
        <div className="max-w-full rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-sm" data-testid="assistant-text">
          <Markdown text={e.content} />
        </div>
      ) : e.status === "streaming" ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
          {e.rechecked ? "Re-checking figures against the fetched data…" : e.tools.length ? "Reading the data…" : "Thinking…"}
        </p>
      ) : null}
      {e.notices.map((n) => (
        <p key={n} role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs">
          {n}
        </p>
      ))}
      {e.status === "stopped" ? <p className="text-xs text-muted">Stopped.</p> : null}
      {e.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/50 bg-danger/5 px-3 py-2 text-sm">
          <AlertIcon size={16} className="text-danger" />
          <span className="flex-1">{e.error ?? "Something went wrong."}</span>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2">
            <RefreshIcon size={12} /> Retry
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** Chat UI shared by /assistant and the city-page sheet. */
export const AssistantChat = forwardRef<AssistantChatHandle, { chatId: string; context?: ChatContext; contextLabel?: string }>(function AssistantChat(
  { chatId, context, contextLabel },
  ref,
) {
  const a = useAssistant(chatId, context);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const now = useNow(1000);
  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }), []);

  const waitSec = a.rateLimitedUntil ? Math.max(0, Math.ceil((a.rateLimitedUntil - now) / 1000)) : 0;
  const rateLimited = waitSec > 0;
  const notConfigured = a.config?.configured === false;
  const canSend = !a.busy && !rateLimited && !notConfigured && text.trim().length > 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [a.entries]);

  function submit(value = text) {
    if (!value.trim() || a.busy || rateLimited || notConfigured) return;
    void a.send(value);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="sr-only" aria-live="polite" role="status">
        {a.announcement}
      </p>
      {contextLabel ? <p className="text-xs text-muted">Context: {contextLabel}</p> : null}

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" data-testid="chat-log">
        {notConfigured ? <NotConfigured model={a.config?.model} /> : null}
        {a.configError ? <p className="text-sm text-danger">Could not reach the assistant service. Check your connection.</p> : null}
        {a.entries.length === 0 && !notConfigured ? (
          <div className="flex flex-col gap-3 py-4" data-testid="chat-empty">
            <p className="text-sm text-muted">
              Ask about air quality anywhere. Answers use live Open-Meteo (CAMS) data fetched for each question; open “Data used” under an answer to see
              exactly what was fetched.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {a.entries.map((e) => (
              <Message key={e.id} e={e} onRetry={() => a.retry(e.id)} />
            ))}
          </ul>
        )}
      </div>

      {!notConfigured ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions" role="group">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={a.busy || rateLimited}
              onClick={() => submit(q)}
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      {rateLimited ? (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm" data-testid="rate-limited">
          You’ve reached the limit of 20 questions per 10 minutes. You can ask again in {waitSec} s.
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={`${id}-input`} className="sr-only">
          Ask AirIQ a question about air quality
        </label>
        <textarea
          ref={inputRef}
          id={`${id}-input`}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_USER_CHARS))}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MAX_USER_CHARS}
          disabled={notConfigured}
          placeholder={notConfigured ? "Assistant not configured" : "Ask about air quality… (Enter to send, Shift+Enter for a new line)"}
          aria-describedby={`${id}-hint`}
          className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2">
          <p id={`${id}-hint`} className="text-[11px] text-muted">
            {text.length}/{MAX_USER_CHARS} · AI answers can be wrong; check the data panel. General information, not medical advice.
          </p>
          <div className="flex gap-2">
            {a.entries.length ? (
              <button type="button" onClick={a.clear} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                Clear chat
              </button>
            ) : null}
            {a.busy ? (
              <button type="button" onClick={a.stop} className="rounded-lg border border-danger/60 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/5">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!canSend} className="rounded-lg bg-text px-4 py-1.5 text-sm font-semibold text-bg disabled:opacity-50">
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
});
