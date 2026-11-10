"use client";

import { useEffect, useState } from "react";

/** Chromium's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * "Install app" button. It exists only after the browser fires
 * `beforeinstallprompt` (i.e. the app is installable and not installed) and
 * disappears after installation or once the prompt has been used.
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred) return null;
  return (
    <button
      type="button"
      data-testid="install-button"
      onClick={async () => {
        const e = deferred;
        setDeferred(null);
        try {
          await e.prompt();
          await e.userChoice;
        } catch {
          // The prompt can only be used once; nothing else to do.
        }
      }}
      className="hidden h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2 sm:inline-flex"
    >
      Install app
    </button>
  );
}
