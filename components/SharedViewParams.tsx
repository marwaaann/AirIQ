"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { scaleStore } from "@/hooks/useAqiScale";
import { profileStore } from "@/hooks/useProfile";
import { SCALE_LABEL } from "@/lib/aqi-display";
import { PROFILES } from "@/lib/profiles";
import { parseSharedPrefs } from "@/lib/share";

/**
 * Opening a shared link (…?scale=eu&profile=athlete) applies that scale and
 * profile so the page looks exactly as it did for the sender. Because these
 * are saved settings, a visible notice says what changed (nothing is shown if
 * they already matched). The parameters are then removed from the address bar
 * so later toggles stay in charge.
 */
export function SharedViewParams() {
  const params = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!params.has("scale") && !params.has("profile")) return;
    const shared = parseSharedPrefs(params);
    // Read the saved values directly: during hydration the hook values are still the defaults.
    const changes: string[] = [];
    if (shared.scale && shared.scale !== scaleStore.get()) {
      scaleStore.set(shared.scale);
      changes.push(SCALE_LABEL[shared.scale]);
    }
    if (shared.profile && shared.profile !== profileStore.get()) {
      profileStore.set(shared.profile);
      changes.push(`${PROFILES[shared.profile].label} profile`);
    }
    if (changes.length) queueMicrotask(() => setNotice(`Opened with the shared link's settings: ${changes.join(" · ")}. You can change them at any time.`));
    const next = new URLSearchParams(window.location.search);
    next.delete("scale");
    next.delete("profile");
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [params]);

  if (!notice) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="shared-view-notice">
      <span>{notice}</span>
      <button type="button" onClick={() => setNotice(null)} className="text-xs font-medium underline">
        Dismiss
      </button>
    </div>
  );
}
