/** Tiny trend line for real hourly values. Decorative: callers provide a text summary. */
export function Sparkline({
  values,
  color = "currentColor",
  height = 28,
  className = "",
}: {
  values: readonly (number | null)[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const w = 100;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const last = values.length - 1 || 1;
  const d = pts
    .map((p, k) => {
      const x = (p.i / last) * w;
      const y = height - 2 - ((p.v - min) / span) * (height - 4);
      return `${k === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
