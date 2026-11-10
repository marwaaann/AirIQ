"use client";

import { useEffect, useId, useRef, useState } from "react";

import { AssistantChat, type AssistantChatHandle } from "@/components/assistant/AssistantChat";
import type { ChatContext } from "@/lib/assistant/protocol";

/**
 * Floating "Ask AirIQ" button + chat sheet (right-hand panel on desktop,
 * full screen on mobile). Passes the current city, profile and scale as context.
 */
export function AskAirIQ({ chatId, context, contextLabel }: { chatId: string; context: ChatContext; contextLabel: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<AssistantChatHandle>(null);
  const titleId = useId();
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // Focus the input once the sheet is rendered; if it is disabled (not configured), focus the first control.
      const t = setTimeout(() => {
        chatRef.current?.focusInput();
        if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
      }, 0);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Tab" && dialogRef.current) {
          // Keep focus inside the dialog.
          const f = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [href], textarea, input, select, summary, [tabindex]:not([tabindex="-1"])')].filter(
            (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
          );
          if (f.length === 0) return;
          const first = f[0];
          const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener("keydown", onKey);
      return () => {
        clearTimeout(t);
        document.removeEventListener("keydown", onKey);
      };
    }
    if (wasOpen.current) buttonRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed bottom-4 left-4 z-[1500] inline-flex items-center gap-2 rounded-full bg-text px-4 py-3 text-sm font-semibold text-bg shadow-xl hover:opacity-90"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />
        </svg>
        Ask AirIQ
      </button>
      {open ? (
        <div className="fixed inset-0 z-[1600]">
          <button type="button" aria-label="Close assistant" tabIndex={-1} className="absolute inset-0 hidden bg-black/40 sm:block" onClick={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-0 flex flex-col gap-3 bg-bg p-4 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[28rem] sm:border-l sm:border-border"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-lg font-semibold">
                Ask AirIQ
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-surface-2"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <AssistantChat ref={chatRef} chatId={chatId} context={context} contextLabel={contextLabel} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
