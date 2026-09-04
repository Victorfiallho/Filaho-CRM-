export interface TrendPoint {
  label: string;
  value: number;
}

// Buckets rows into `weeks` consecutive 7-day windows ending "today", summing
// valueOf(row) per window. A week with no matching rows still gets a zero
// point (not skipped) so the line has no gaps to misread as missing data.
export function weeklyTrend<T>(
  rows: T[],
  dateOf: (row: T) => string,
  valueOf: (row: T) => number,
  weeks: number,
  now: Date = new Date()
): TrendPoint[] {
  const msPerWeek = 7 * 86400000;
  // Align to local midnight so "this week's" boundary doesn't drift with
  // the time of day the dashboard happens to be loaded.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const bucketEnd = new Date(end.getTime() - i * msPerWeek);
    const bucketStart = new Date(bucketEnd.getTime() - msPerWeek);
    const sum = rows.reduce((total, row) => {
      const d = new Date(dateOf(row));
      return d > bucketStart && d <= bucketEnd ? total + valueOf(row) : total;
    }, 0);
    points.push({ label: bucketEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: sum });
  }
  return points;
}
