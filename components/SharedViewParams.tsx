"use client";

import { useState } from "react";

import { scaleStore } from "@/hooks/useAqiScale";
import { dataSourceStore } from "@/hooks/useDataSource";
import { profileStore } from "@/hooks/useProfile";
import { useViewOverride } from "@/hooks/useViewOverride";
import { useStoredValue } from "@/lib/storage";
import { saveSharedPrefs, sharedViewNotice } from "@/lib/view-prefs";

/**
 * Notice for a shared link (…?scale=eu&profile=athlete&source=model): the page shows the
 * link's scale/profile/data source for this view only, and nothing is saved unless the
 * user clicks "Save as my settings".
 */
export function SharedViewParams() {
  const view = useViewOverride();
  const [storedScale] = useStoredValue(scaleStore);
  const [storedProfile] = useStoredValue(profileStore);
  const [storedSource] = useStoredValue(dataSourceStore);
  const [hidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!view) return null;
  const stored = { scale: storedScale, profile: storedProfile, source: storedSource };
  const notice = sharedViewNotice(view.override, stored);

  if (saved) {
    return (
      <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="shared-view-saved">
        Saved as your settings.
      </p>
    );
  }
  if (!notice || hidden) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="shared-view-notice">
      <span>{notice}. Your saved settings are unchanged.</span>
      <span className="flex gap-2">
        <button
          type="button"
          data-testid="save-shared-settings"
          onClick={() => {
            saveSharedPrefs(view.override, stored, { scale: scaleStore, profile: profileStore, source: dataSourceStore });
            view.clear(["scale", "profile", "source"]);
            setSaved(true);
          }}
          className="rounded-md bg-text px-3 py-1 text-xs font-semibold text-bg"
        >
          Save as my settings
        </button>
        <button type="button" onClick={() => setHidden(true)} className="rounded-md px-2 py-1 text-xs font-medium underline">
          Dismiss
        </button>
      </span>
    </div>
  );
}
