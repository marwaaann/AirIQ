/**
 * AirIQ trend model: additive Holt-Winters with a damped trend and a 24-hour
 * (local hour-of-day) season, fitted on log(1 + PM2.5).
 *
 *   x_t        = ln(1 + y_t)
 *   forecast   x̂_{t+k} = ℓ_t + (φ + φ² + … + φᵏ)·b_t + s[hour(t+k)]
 *   level      ℓ_t = α·(x_t − s[hour(t)]) + (1 − α)·(ℓ_{t−1} + φ·b_{t−1})
 *   trend      b_t = β·(ℓ_t − ℓ_{t−1}) + (1 − β)·φ·b_{t−1}
 *   season     s[hour(t)] ← γ·(x_t − ℓ_t) + (1 − γ)·s[hour(t)]
 *   output     ŷ = max(0, e^{x̂} − 1)
 *
 * Missing hours never update the state: level/trend roll forward by the trend
 * and the season is left unchanged (no silent interpolation). α, β, γ, φ are
 * chosen by grid search minimizing one-step-ahead squared error on the
 * training data only, scored by MULTI-STEP error (forecasts 1–24 h ahead from
 * an origin every 6 h) because the model is used for a 48-h horizon and
 * one-step error alone favours a level that chases short-lived noise.
 * Prediction intervals come from backtest residual
 * quantiles per horizon bucket. Pure module, no dependencies.
 */

export const SEASON = 24;
export const DEFAULT_HORIZON = 48;
export const MIN_VALID_HOURS = 7 * 24;
export const MAX_MISSING_FRACTION = 0.25;
export const MAX_TRAIN_HOURS = 28 * 24;

export interface HWParams {
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
}

export interface HWState {
  level: number;
  trend: number;
  season: number[];
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const tf = (v: number) => Math.log1p(Math.max(0, v));
const itf = (v: number) => Math.max(0, Math.expm1(v));

const GRID = {
  alpha: [0.05, 0.1, 0.2, 0.35, 0.5, 0.7],
  beta: [0, 0.02, 0.1],
  gamma: [0.05, 0.15, 0.3],
  phi: [0.85, 0.95],
} as const;

/** Initial state from the first 7 days: per-hour mean minus overall mean. */
export function initState(x: readonly (number | null)[], hours: readonly number[]): HWState | null {
  const span = Math.min(x.length, 7 * SEASON);
  const sum = new Array<number>(SEASON).fill(0);
  const cnt = new Array<number>(SEASON).fill(0);
  let total = 0;
  let n = 0;
  for (let i = 0; i < span; i++) {
    const v = x[i];
    if (!isNum(v)) continue;
    sum[hours[i]] += v;
    cnt[hours[i]] += 1;
    total += v;
    n++;
  }
  if (n === 0) return null;
  const mean = total / n;
  return {
    level: mean,
    trend: 0,
    season: sum.map((s, h) => (cnt[h] ? s / cnt[h] - mean : 0)),
  };
}

export interface FilterResult {
  state: HWState;
  sse: number;
  errors: number;
}

/** Run the recursions over x[0..x.length) from `state0`; returns the state ready to forecast x.length. */
export function runFilter(
  x: readonly (number | null)[],
  hours: readonly number[],
  p: HWParams,
  state0: HWState,
  warmup = SEASON,
): FilterResult {
  let { level, trend } = state0;
  const season = state0.season.slice();
  let sse = 0;
  let errors = 0;
  for (let t = 0; t < x.length; t++) {
    const h = hours[t];
    const v = x[t];
    const prevLevel = level;
    if (isNum(v)) {
      const pred = level + p.phi * trend + season[h];
      if (t >= warmup) {
        sse += (v - pred) ** 2;
        errors++;
      }
      level = p.alpha * (v - season[h]) + (1 - p.alpha) * (prevLevel + p.phi * trend);
      trend = p.beta * (level - prevLevel) + (1 - p.beta) * p.phi * trend;
      season[h] = p.gamma * (v - level) + (1 - p.gamma) * season[h];
    } else {
      level = prevLevel + p.phi * trend;
      trend = p.phi * trend;
    }
  }
  return { state: { level, trend, season }, sse, errors };
}

/** k-step forecasts (original units) for the given future local hours. */
export function forecastFrom(state: HWState, p: HWParams, futureHours: readonly number[]): number[] {
  const out: number[] = [];
  let damp = 0;
  let phiK = 1;
  for (let k = 0; k < futureHours.length; k++) {
    phiK *= p.phi;
    damp += phiK;
    out.push(itf(state.level + damp * state.trend + state.season[futureHours[k]]));
  }
  return out;
}

/**
 * Mean squared multi-step error (transformed scale) of a parameter set: from
 * an origin every `every` hours, forecast up to `horizon` hours ahead with
 * the state at that origin and compare with the later observations. Only the
 * data passed in is used.
 */
export function multiStepScore(
  x: readonly (number | null)[],
  hours: readonly number[],
  p: HWParams,
  state0: HWState,
  horizon = 24,
  every = 6,
  warmup = 2 * SEASON,
): { mse: number; n: number } {
  let level = state0.level;
  let trend = state0.trend;
  const season = state0.season.slice();
  let se = 0;
  let n = 0;
  for (let t = 0; t < x.length; t++) {
    if (t >= warmup && t % every === 0) {
      let damp = 0;
      let phiK = 1;
      for (let k = 1; k <= horizon && t + k - 1 < x.length; k++) {
        phiK *= p.phi;
        damp += phiK;
        const a = x[t + k - 1];
        if (!isNum(a)) continue;
        se += (a - (level + damp * trend + season[hours[t + k - 1]])) ** 2;
        n++;
      }
    }
    const h = hours[t];
    const v = x[t];
    const prevLevel = level;
    if (isNum(v)) {
      level = p.alpha * (v - season[h]) + (1 - p.alpha) * (prevLevel + p.phi * trend);
      trend = p.beta * (level - prevLevel) + (1 - p.beta) * p.phi * trend;
      season[h] = p.gamma * (v - level) + (1 - p.gamma) * season[h];
    } else {
      level = prevLevel + p.phi * trend;
      trend = p.phi * trend;
    }
  }
  return { mse: n ? se / n : Infinity, n };
}

export interface Fit {
  params: HWParams;
  state: HWState;
  rmseOneStep: number;
}

/** Grid-search the parameters on `values` (original units) and return the fitted end state. */
export function fit(values: readonly (number | null)[], hours: readonly number[]): Fit | null {
  const x = values.map((v) => (isNum(v) ? tf(v) : null));
  const s0 = initState(x, hours);
  if (!s0) return null;
  let best: { params: HWParams; score: number } | null = null;
  for (const alpha of GRID.alpha)
    for (const beta of GRID.beta)
      for (const gamma of GRID.gamma)
        for (const phi of GRID.phi) {
          const params = { alpha, beta, gamma, phi };
          const { mse, n } = multiStepScore(x, hours, params, s0);
          if (n === 0) continue;
          if (!best || mse < best.score) best = { params, score: mse };
        }
  if (!best) return null;
  const r = runFilter(x, hours, best.params, s0);
  return { params: best.params, state: r.state, rmseOneStep: r.errors ? Math.sqrt(r.sse / r.errors) : NaN };
}

/* ------------------------------------------------------------------------- */
/* Metrics, backtest, intervals                                               */
/* ------------------------------------------------------------------------- */

export interface Metrics {
  mae: number;
  rmse: number;
  n: number;
}

export function metrics(actual: readonly (number | null)[], pred: readonly (number | null)[], mask?: readonly boolean[]): Metrics {
  let ae = 0;
  let se = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const p = pred[i];
    if (!isNum(a) || !isNum(p) || (mask && !mask[i])) continue;
    ae += Math.abs(a - p);
    se += (a - p) ** 2;
    n++;
  }
  return { mae: n ? ae / n : NaN, rmse: n ? Math.sqrt(se / n) : NaN, n };
}

/** Persistence: the last observed training value for every horizon. */
export function persistenceForecast(train: readonly (number | null)[], horizon: number): (number | null)[] {
  let last: number | null = null;
  for (let i = train.length - 1; i >= 0; i--) {
    const v = train[i];
    if (isNum(v)) {
      last = v;
      break;
    }
  }
  return Array.from({ length: horizon }, () => last);
}

/** Seasonal naive: same local hour on the most recent training day (index always < train.length). */
export function seasonalNaiveForecast(train: readonly (number | null)[], horizon: number): (number | null)[] {
  const T = train.length;
  return Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const idx = T - 1 + h - SEASON * Math.ceil(h / SEASON);
    const v = idx >= 0 ? train[idx] : null;
    return isNum(v) ? v : null;
  });
}

export interface BacktestResult {
  holdout: number;
  trainHours: number;
  model: Metrics;
  persistence: Metrics;
  seasonalNaive: Metrics;
  /** Per-hour predictions on the held-out window (for tests and charts). */
  predictions: { actual: (number | null)[]; model: number[]; persistence: (number | null)[]; seasonalNaive: (number | null)[] };
}

/**
 * Hold out the last `holdout` hours, fit on the rest ONLY, and compare the
 * model with persistence and seasonal-naive on the hours where every method
 * and the actual value exist.
 */
export function backtest(values: readonly (number | null)[], hours: readonly number[], holdout = DEFAULT_HORIZON): BacktestResult | null {
  const T = values.length - holdout;
  if (T < MIN_VALID_HOURS) return null;
  const train = values.slice(0, T);
  const trainHours = hours.slice(0, T);
  const f = fit(train, trainHours);
  if (!f) return null;
  const actual = values.slice(T);
  const model = forecastFrom(f.state, f.params, hours.slice(T, T + holdout));
  const persistence = persistenceForecast(train, holdout);
  const seasonalNaive = seasonalNaiveForecast(train, holdout);
  const mask = actual.map((a, i) => isNum(a) && isNum(persistence[i]) && isNum(seasonalNaive[i]));
  return {
    holdout,
    trainHours: T,
    model: metrics(actual, model, mask),
    persistence: metrics(actual, persistence, mask),
    seasonalNaive: metrics(actual, seasonalNaive, mask),
    predictions: { actual, model, persistence, seasonalNaive },
  };
}

export interface HorizonBucket {
  from: number;
  to: number;
}

export const HORIZON_BUCKETS: readonly HorizonBucket[] = [
  { from: 1, to: 6 },
  { from: 7, to: 24 },
  { from: 25, to: 48 },
];

export interface IntervalBucket extends HorizonBucket {
  /** 10th / 90th percentile of (actual − predicted), original units. */
  q10: number;
  q90: number;
  n: number;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Residual quantiles from rolling-origin backtests: origins every 24 h ending
 * at values.length − horizon. Parameters are fitted only on data before the
 * EARLIEST origin; each origin's state uses only data before that origin.
 */
export function residualIntervals(
  values: readonly (number | null)[],
  hours: readonly number[],
  horizon = DEFAULT_HORIZON,
  maxOrigins = 7,
): IntervalBucket[] | null {
  const last = values.length - horizon;
  const origins: number[] = [];
  for (let k = 0; k < maxOrigins; k++) {
    const o = last - SEASON * k;
    if (o - MIN_VALID_HOURS < 0) break;
    origins.unshift(o);
  }
  if (origins.length < 2) return null;
  const first = origins[0];
  const f = fit(values.slice(0, first), hours.slice(0, first));
  if (!f) return null;
  const x = values.map((v) => (isNum(v) ? tf(v) : null));
  const s0 = initState(x.slice(0, first), hours.slice(0, first));
  if (!s0) return null;

  const residuals: number[][] = HORIZON_BUCKETS.map(() => []);
  for (const o of origins) {
    const { state } = runFilter(x.slice(0, o), hours.slice(0, o), f.params, s0);
    const pred = forecastFrom(state, f.params, hours.slice(o, o + horizon));
    for (let k = 1; k <= horizon; k++) {
      const a = values[o + k - 1];
      if (!isNum(a)) continue;
      const b = HORIZON_BUCKETS.findIndex((bk) => k >= bk.from && k <= bk.to);
      if (b >= 0) residuals[b].push(a - pred[k - 1]);
    }
  }
  return HORIZON_BUCKETS.map((bk, i) => {
    const r = residuals[i].slice().sort((a, b) => a - b);
    return { ...bk, q10: quantile(r, 0.1), q90: quantile(r, 0.9), n: r.length };
  });
}

export function bucketFor(k: number, buckets: readonly IntervalBucket[]): IntervalBucket | undefined {
  return buckets.find((b) => k >= b.from && k <= b.to);
}

/* ------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* ------------------------------------------------------------------------- */

export interface ModelPoint {
  /** Steps ahead (1 = next hour). */
  k: number;
  value: number;
  lo: number;
  hi: number;
}

export type TrendModelResult =
  | {
      status: "ok";
      params: HWParams;
      trainHours: number;
      validHours: number;
      forecast: ModelPoint[];
      backtest: BacktestResult;
      intervals: IntervalBucket[];
    }
  | { status: "insufficient"; reason: string; validHours: number; trainHours: number };

/**
 * Fit on the most recent ≤28 days, backtest the last 48 h, derive 80%
 * intervals, then forecast `futureHours.length` hours ahead.
 */
export function runTrendModel(
  allValues: readonly (number | null)[],
  allHours: readonly number[],
  futureHours: readonly number[],
): TrendModelResult {
  const start = Math.max(0, allValues.length - MAX_TRAIN_HOURS);
  const values = allValues.slice(start);
  const hours = allHours.slice(start);
  const validHours = values.filter(isNum).length;
  const missing = values.length ? 1 - validHours / values.length : 1;
  const base = { validHours, trainHours: values.length };

  if (validHours < MIN_VALID_HOURS + DEFAULT_HORIZON) {
    return { status: "insufficient", reason: `only ${validHours} valid hours (need ${MIN_VALID_HOURS + DEFAULT_HORIZON})`, ...base };
  }
  if (missing > MAX_MISSING_FRACTION) {
    return { status: "insufficient", reason: `${Math.round(missing * 100)}% of hours are missing (max ${MAX_MISSING_FRACTION * 100}%)`, ...base };
  }
  const bt = backtest(values, hours, DEFAULT_HORIZON);
  const intervals = residualIntervals(values, hours, DEFAULT_HORIZON);
  const f = fit(values, hours);
  if (!bt || !intervals || !f || intervals.some((b) => b.n < 5 || !Number.isFinite(b.q10))) {
    return { status: "insufficient", reason: "not enough complete history to backtest the model", ...base };
  }
  const point = forecastFrom(f.state, f.params, futureHours);
  const forecast = point.map((value, i) => {
    const b = bucketFor(i + 1, intervals) ?? intervals[intervals.length - 1];
    return { k: i + 1, value, lo: Math.max(0, value + b.q10), hi: Math.max(0, value + b.q90) };
  });
  return { status: "ok", params: f.params, ...base, forecast, backtest: bt, intervals };
}
