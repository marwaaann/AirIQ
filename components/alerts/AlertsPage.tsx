"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { CitySearch } from "@/components/CitySearch";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import { ProfileSelector } from "@/components/ProfileSelector";
import { EmptyState } from "@/components/states";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useNow } from "@/hooks/useNow";
import { useNotificationPermission, type NotificationStatus } from "@/hooks/useNotificationPermission";
import { useProfile } from "@/hooks/useProfile";
import { eventsStore, newRuleId, requestAlertCheck, ruleStatesStore, rulesStore } from "@/lib/alert-store";
import { ALERT_METRICS, AlertRuleSchema, FORECAST_HOURS, metricLabel, type AlertMetric, type AlertRule } from "@/lib/alerts";
import { SCALE_NAME } from "@/lib/aqi-categories";
import { formatHour } from "@/lib/time";
import { timeAgo } from "@/lib/format";
import { makeCitySlug } from "@/lib/slug";
import { useHydrated, useStoredValue } from "@/lib/storage";
import { pushToast } from "@/lib/toast-store";
import type { AqiScale } from "@/types/air";

type City = AlertRule["city"];
type TriggerChoice = "current" | `forecast-${(typeof FORECAST_HOURS)[number]}`;

const METRIC_NAME: Record<AlertMetric, string> = {
  aqi: "Overall AQI",
  pm2_5: "PM2.5",
  pm10: "PM10",
  nitrogen_dioxide: "NO₂",
  ozone: "O₃",
};

function triggerText(r: AlertRule): string {
  return r.trigger.type === "current" ? "current reading" : `forecast within the next ${r.trigger.hours} h`;
}

/* ------------------------------------------------------------------------- */

function NotificationsPanel() {
  const { status, request } = useNotificationPermission();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const text: Record<NotificationStatus, string> = {
    unsupported: "This browser does not support notifications. Alerts still appear in the app (bell, alert list and on-screen messages).",
    default: "Browser notifications are off. Alerts still appear in the app.",
    granted: "Browser notifications are on.",
    denied:
      "Browser notifications are blocked for this site. Alerts still appear in the app (bell, alert list and on-screen messages). To get browser notifications, allow them in your browser's site settings.",
  };
  return (
    <section aria-labelledby="notif-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <h2 id="notif-title" className="font-semibold">
        Browser notifications
      </h2>
      <p className="text-sm" data-testid="notification-status" data-status={hydrated ? status : "loading"}>
        <span className="font-medium">Status: {hydrated ? status : "…"}.</span> {hydrated ? text[status] : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {hydrated && status === "default" ? (
          <button
            type="button"
            onClick={async () => {
              const r = await request();
              setMessage(r === "granted" ? "Notifications enabled." : r === "denied" ? "Notifications were blocked. Alerts will stay in-app." : null);
            }}
            className="rounded-lg bg-text px-3 py-2 text-sm font-semibold text-bg"
          >
            Enable browser notifications
          </button>
        ) : null}
        <button
          type="button"
          disabled={!hydrated || status !== "granted"}
          onClick={() => {
            try {
              new Notification("AirIQ test notification", { body: "Notifications are working. Real alerts look like this.", tag: "airiq-test" });
              setMessage("Test notification sent.");
            } catch {
              setMessage("This browser refused to show a notification from the page.");
            }
          }}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          Send test notification
        </button>
      </div>
      {message ? (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

function cityFromParams(params: URLSearchParams): City | null {
  if (params.get("new") !== "1") return null;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const name = params.get("name");
  const tz = params.get("tz");
  if (!name || !tz || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: name.slice(0, 120), latitude: lat, longitude: lon, timezone: tz.slice(0, 64), slug: params.get("slug") || makeCitySlug(name, lat, lon) };
}

function RuleForm() {
  const params = useSearchParams();
  const [activeScale] = useAqiScale();
  const [profile] = useProfile();
  const formId = useId();
  const [city, setCity] = useState<City | null>(() => cityFromParams(new URLSearchParams(params.toString())));
  const [cityError, setCityError] = useState<string | null>(null);
  const [metric, setMetric] = useState<AlertMetric>("aqi");
  const [scale, setScale] = useState<AqiScale>(activeScale);
  const [thresholdText, setThresholdText] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TriggerChoice>("current");
  const [quiet, setQuiet] = useState(false);
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [, setRules] = useStoredValue(rulesStore);

  const defaultThreshold = profile.defaultThreshold[scale];
  const threshold = thresholdText ?? String(defaultThreshold);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!city) {
      setError("Choose a city.");
      return;
    }
    const rule = {
      id: newRuleId(),
      city,
      metric,
      scale,
      threshold: Number(threshold),
      trigger: trigger === "current" ? { type: "current" as const } : { type: "forecast" as const, hours: Number(trigger.split("-")[1]) },
      quietHours: quiet ? { start: quietStart, end: quietEnd } : null,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const parsed = AlertRuleSchema.safeParse(rule);
    if (!parsed.success) {
      setError("Threshold must be a whole number between 1 and 1000.");
      return;
    }
    setRules((prev) => [...prev, parsed.data]);
    pushToast({ title: "Alert created", body: `${metricLabel(metric, scale)} ${triggerText(parsed.data)} above ${parsed.data.threshold} in ${city.name}. Checking now…`, tone: "info" });
    if (params.get("new")) window.history.replaceState(null, "", "/alerts");
    requestAlertCheck();
  }

  const field = "flex flex-col gap-1 text-sm";
  const control = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm";
  const changeRef = useRef<HTMLButtonElement>(null);

  return (
    <section aria-labelledby={`${formId}-title`} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <h2 id={`${formId}-title`} className="font-semibold">
        New alert
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-4" aria-describedby={error ? `${formId}-err` : undefined}>
        <div className={field}>
          <span className="font-medium">City</span>
          {city ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-surface-2 px-3 py-1.5 font-medium" data-testid="form-city">
                {city.name}
              </span>
              <span className="text-xs text-muted">{city.timezone}</span>
              <button ref={changeRef} type="button" onClick={() => setCity(null)} className="text-xs font-medium text-brand underline underline-offset-2">
                Change
              </button>
            </div>
          ) : (
            <>
              <CitySearch
                label="City for this alert"
                onPick={(p) => {
                  if (!p.timezone) {
                    setCityError("This place has no time zone in the geocoder, so quiet hours and forecast times can't be shown. Pick another result.");
                    return;
                  }
                  setCityError(null);
                  // The search box is replaced by the chosen city; keep keyboard focus there.
                  requestAnimationFrame(() => changeRef.current?.focus());
                  setCity({ name: p.name, latitude: p.latitude, longitude: p.longitude, timezone: p.timezone, slug: makeCitySlug(p.name, p.latitude, p.longitude) });
                }}
              />
              {cityError ? <p className="text-xs text-danger">{cityError}</p> : null}
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            <span className="font-medium">Measure</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)} className={control} name="metric">
              {ALERT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {METRIC_NAME[m]}
                  {m !== "aqi" ? " (sub-index)" : ""}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={field}>
            <legend className="mb-1 font-medium">Scale</legend>
            <div className="flex gap-3">
              {(["us", "eu", "in"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input type="radio" name="scale" checked={scale === s} onChange={() => setScale(s)} className="accent-[var(--brand)]" />
                  {SCALE_NAME[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={field}>
            <span className="font-medium">Alert when above</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              step={1}
              required
              name="threshold"
              value={threshold}
              onChange={(e) => setThresholdText(e.target.value)}
              className={control}
            />
            <span className="text-xs text-muted">
              Default for your profile ({profile.label}): {defaultThreshold} on the {SCALE_NAME[scale]}. The threshold is stored with this scale.
              {scale === "in" ? " NAQI is computed by AirIQ from concentrations (station-based when available, else model-based)." : ""} Current-reading
              alerts use the headline in effect (nearby stations first, as set in Data source).
            </span>
          </label>
          <label className={field}>
            <span className="font-medium">Check</span>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerChoice)} className={control} name="trigger">
              <option value="current">Current reading</option>
              {FORECAST_HOURS.map((h) => (
                <option key={h} value={`forecast-${h}`}>
                  Official forecast, next {h} h
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" name="quiet" />
            Quiet hours (no browser notification; still logged)
          </label>
          {quiet ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                From
                <select value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))} className={control} name="quietStart">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                to
                <select value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))} className={control} name="quietEnd">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-muted">in the city&rsquo;s local time{city ? ` (${city.timezone})` : ""}; may cross midnight.</span>
            </div>
          ) : null}
        </div>

        <div className="max-w-xs">
          <ProfileSelector />
        </div>

        {error ? (
          <p id={`${formId}-err`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className="self-start rounded-lg bg-text px-4 py-2 text-sm font-semibold text-bg">
          Save alert
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------------- */

function RulesList() {
  const [rules, setRules] = useStoredValue(rulesStore);
  const [states, setStates] = useStoredValue(ruleStatesStore);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const hydrated = useHydrated();
  const now = useNow(30_000);
  if (!hydrated) return null;

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rules-title" className="text-lg font-semibold">
          Your alerts ({rules.length})
        </h2>
        <button
          type="button"
          onClick={requestAlertCheck}
          disabled={rules.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          <RefreshIcon size={14} /> Check now
        </button>
      </div>
      {rules.length === 0 ? (
        <EmptyState title="No alerts yet" icon={<AlertIcon size={22} />}>
          Create one below, or use “Create alert” on any city page.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r) => {
            const st = states[r.id];
            const draft = drafts[r.id] ?? String(r.threshold);
            return (
              <li key={r.id} data-rule-id={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <Link prefetch={false} href={`/city/${r.city.slug}`} className="underline-offset-4 hover:underline">
                        {r.city.name}
                      </Link>
                      : {metricLabel(r.metric, r.scale)} above {r.threshold}
                    </p>
                    <p className="text-xs text-muted">
                      {triggerText(r)}
                      {r.quietHours ? ` · quiet ${formatHour(r.quietHours.start)}–${formatHour(r.quietHours.end)} local` : ""}
                    </p>
                    <p className="text-xs" data-testid="rule-state">
                      {!r.enabled
                        ? "Paused"
                        : st?.active
                          ? "Above threshold: alerted once; will re-arm when it drops"
                          : "Armed: will alert when the value goes above the threshold"}
                      {st?.lastValue !== null && st?.lastValue !== undefined ? ` · last value ${Math.round(st.lastValue)}` : ""}
                      {st?.lastEvaluatedAt ? ` · checked ${timeAgo(st.lastEvaluatedAt, now)}` : ""}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={r.enabled}
                      aria-checked={r.enabled}
                      onChange={(e) => setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                    Enabled
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs">
                    Threshold
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                      aria-label={`Threshold for ${r.city.name}`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={draft === String(r.threshold)}
                    onClick={() => {
                      const t = Number(draft);
                      if (!Number.isInteger(t) || t < 1 || t > 1000) return;
                      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, threshold: t } : x)));
                      setDrafts((d) => {
                        const n = { ...d };
                        delete n[r.id];
                        return n;
                      });
                      requestAlertCheck();
                    }}
                    className="rounded-lg border border-border px-3 py-1 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
                  >
                    Save threshold
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRules((prev) => prev.filter((x) => x.id !== r.id));
                      setStates((prev) => {
                        const n = { ...prev };
                        delete n[r.id];
                        return n;
                      });
                    }}
                    className="ml-auto rounded-lg border border-danger/50 px-3 py-1 text-sm font-medium text-danger hover:bg-danger/5"
                    aria-label={`Delete alert for ${r.city.name}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

function EventHistory() {
  const [events, setEvents] = useStoredValue(eventsStore);
  const hydrated = useHydrated();
  const now = useNow(30_000);
  if (!hydrated) return null;
  const unread = events.filter((e) => !e.read).length;
  return (
    <section aria-labelledby="events-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="events-title" className="text-lg font-semibold">
          Alert history ({events.length})
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={unread === 0}
            onClick={() => setEvents((prev) => prev.map((e) => ({ ...e, read: true })))}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            Mark all read
          </button>
          <button
            type="button"
            disabled={events.length === 0}
            onClick={() => setEvents([])}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            Clear all
          </button>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No alerts have fired yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="event-list">
          {events.map((e) => (
            <li key={e.id} data-event-id={e.id} data-suppressed={e.suppressed} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {!e.read ? <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-danger-contrast">New</span> : null}
                {e.title}
                {e.suppressed ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted">Suppressed (quiet hours)</span>
                ) : null}
              </p>
              <p className="text-muted">{e.message}</p>
              {e.source ? (
                <p className="text-xs" data-testid="event-source">
                  Source: {e.source}
                </p>
              ) : null}
              <p className="text-xs text-muted">
                <time dateTime={e.createdAt}>{timeAgo(e.createdAt, now)}</time> ·{" "}
                <Link prefetch={false} href={`/city/${e.citySlug}`} className="underline underline-offset-2">
                  Open {e.cityName}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

export function AlertsPage() {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Smart alerts</h1>
        <p role="note" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="open-tab-note">
          <strong>Alerts only run while AirIQ is open in a browser tab.</strong> There is no background service or server push: if every AirIQ tab is closed,
          nothing is checked and nothing is sent. While a tab is open, alerts are re-checked every 10 minutes, when you return to the tab, and when you press
          “Check now”.
        </p>
      </div>
      <NotificationsPanel />
      <RulesList />
      <RuleForm />
      <EventHistory />
    </div>
  );
}
