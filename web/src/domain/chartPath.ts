// Geometry for the area trend chart. Pure, so chartPath.test.ts can pin it.

export interface Pt { x: number; y: number }

// Monotone cubic interpolation (Fritsch-Carlson, like d3's curveMonotoneX):
// smooth, but never overshoots between points. Plain bezier smoothing would
// dip below zero between a 0 week and a 6 week.
export function monotonePath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(points[0].x)},${f(points[0].y)}`;
  if (n === 2) return `M${f(points[0].x)},${f(points[0].y)}L${f(points[1].x)},${f(points[1].y)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }
  // Tangents: average of neighboring secants, zeroed at local extrema and
  // clamped so the curve stays monotone within each segment.
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  t[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }

  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const h = dx[i] / 3;
    d += `C${f(p0.x + h)},${f(p0.y + t[i] * h)},${f(p1.x - h)},${f(p1.y - t[i + 1] * h)},${f(p1.x)},${f(p1.y)}`;
  }
  return d;
}

const f = (n: number) => Number(n.toFixed(2));

// Recent half vs the half before it ("+40% vs previous 6 weeks").
// null when there's nothing to compare against (earlier half was zero).
export function periodChange(values: number[]): { recent: number; previous: number; pct: number | null } {
  const half = Math.floor(values.length / 2);
  const recent = values.slice(values.length - half).reduce((a, b) => a + b, 0);
  const previous = values.slice(values.length - 2 * half, values.length - half).reduce((a, b) => a + b, 0);
  return { recent, previous, pct: previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null };
}

// Rounded axis max: 1, 2, 5, 10, 20, 50…
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

// Evenly spaced indexes for x-axis labels, always including both ends.
export function tickIndexes(count: number, maxTicks: number): number[] {
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxTicks - 1);
  return Array.from(new Set(Array.from({ length: maxTicks }, (_, i) => Math.round(i * step))));
}
