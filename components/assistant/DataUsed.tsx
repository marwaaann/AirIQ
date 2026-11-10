"use client";

import type { ToolChip } from "@/hooks/useAssistant";

const TOOL_LABEL: Record<string, string> = {
  resolve_city: "Find city",
  get_current_aqi: "Current AQI",
  get_history: "History",
  get_forecast: "Forecast",
  compare_cities: "Compare cities",
  get_health_advice: "Health advice",
  find_safe_windows: "Safe windows",
};

/** Tool-call chips for one answer, expanding into a "Data used" panel. */
export function DataUsed({ tools }: { tools: ToolChip[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="data-used">
      <ul className="flex flex-wrap gap-1.5" aria-label="Data fetched for this answer">
        {tools.map((t) => (
          <li
            key={t.id}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
              t.ok === false ? "border-danger/50 text-danger" : "border-border text-muted"
            }`}
          >
            {t.ok === null ? (
              <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
            ) : (
              <span aria-hidden>{t.ok ? "✓" : "!"}</span>
            )}
            <span className="truncate">{t.summary ?? `${TOOL_LABEL[t.name] ?? t.name}…`}</span>
          </li>
        ))}
      </ul>
      <details className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none font-medium">Data used ({tools.length})</summary>
        <ol className="mt-2 flex flex-col gap-3">
          {tools.map((t) => (
            <li key={t.id} className="flex flex-col gap-1">
              <p>
                <span className="font-mono font-semibold">{t.name}</span>{" "}
                <span className="text-muted">
                  ({TOOL_LABEL[t.name] ?? "tool"}){t.ok === false ? " · failed" : t.ok === null ? " · running" : ""}
                </span>
              </p>
              <p className="break-all font-mono text-[11px] text-muted">args: {JSON.stringify(t.args)}</p>
              {Object.keys(t.keyValues).length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {Object.entries(t.keyValues).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-mono">{v === null ? "n/a" : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {t.summary ? <p className="text-muted">{t.summary}</p> : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-muted">Source: Open-Meteo (CAMS) via AirIQ tools. Numbers in the answer are checked against these results.</p>
      </details>
    </div>
  );
}
