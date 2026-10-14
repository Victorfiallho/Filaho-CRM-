export interface TrendPoint {
  label: string;
  value: number;
}

// Sums valueOf(row) into `weeks` 7-day windows ending today. Empty weeks
// are zero points, not gaps.
export function weeklyTrend<T>(
  rows: T[],
  dateOf: (row: T) => string,
  valueOf: (row: T) => number,
  weeks: number,
  now: Date = new Date()
): TrendPoint[] {
  const msPerWeek = 7 * 86400000;
  // From local midnight, so the week boundary doesn't move with the time of day.
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
