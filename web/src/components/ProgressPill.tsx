import type { Tone } from "../domain/visual";

// Short pill bar: the filled share in the tone's color, the remainder
// hatched with light diagonal stripes. Scaled against `max` (the largest
// value in the same list), like BarRow, so equal lengths mean equal values.
export default function ProgressPill({ value, max, tone, label }: { value: number; max: number; tone: Tone; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={`progress-pill tone-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className="progress-pill-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
