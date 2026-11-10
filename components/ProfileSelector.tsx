"use client";

import { useId } from "react";

import { useProfile } from "@/hooks/useProfile";
import { PROFILE_IDS, PROFILES, type ProfileId } from "@/lib/profiles";

/** Health profile picker. Writes to the shared, persisted profile unless `value`/`onChange` are given. */
export function ProfileSelector({
  value,
  onChange,
  compact = false,
}: {
  value?: ProfileId;
  onChange?: (id: ProfileId) => void;
  compact?: boolean;
}) {
  const [saved, setSaved] = useProfile();
  const id = useId();
  const current = value ?? saved.id;
  const set = onChange ?? setSaved;
  return (
    <div className={`flex ${compact ? "items-center gap-2" : "flex-col gap-1"}`}>
      <label htmlFor={id} className={compact ? "text-sm text-muted" : "text-sm font-medium"}>
        Health profile
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => set(e.target.value as ProfileId)}
        aria-describedby={compact ? undefined : `${id}-desc`}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
      >
        {PROFILE_IDS.map((p) => (
          <option key={p} value={p}>
            {PROFILES[p].label}
          </option>
        ))}
      </select>
      {!compact ? (
        <p id={`${id}-desc`} className="text-xs text-muted">
          {PROFILES[current].description}
        </p>
      ) : null}
    </div>
  );
}
