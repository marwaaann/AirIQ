"use client";

import { CategoryBadge } from "@/components/CategoryBadge";
import { useAdvice } from "@/components/health/advice-common";
import { useProfile } from "@/hooks/useProfile";
import type { AqiScale } from "@/types/air";
import type { AirResponse } from "@/types/api";

/** Compact health advice for the Overview tab: headline + top 3 recommendations. */
export function AdviceCard({ air, scale, onMore }: { air: AirResponse; scale: AqiScale; onMore: () => void }) {
  const advice = useAdvice(air, scale);
  const [profile] = useProfile();
  if (!advice) return null;
  return (
    <section aria-labelledby="advice-card-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="advice-card-title" className="text-base font-semibold">
          Health advice · {profile.label}
        </h2>
        <CategoryBadge category={advice.category} size="sm" />
      </div>
      <p className="font-medium">{advice.headline.text}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {advice.top.map((r) => (
          <li key={r.id} className="flex gap-2">
            <span aria-hidden className="text-brand">
              ●
            </span>
            {r.text}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>General information, not medical advice.</span>
        <button type="button" onClick={onMore} className="font-semibold text-brand underline underline-offset-2">
          All health advice and safe times →
        </button>
      </div>
    </section>
  );
}
