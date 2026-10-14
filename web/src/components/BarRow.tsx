import type { ReactNode } from "react";

// One labeled bar scaled against `max` (the largest value in its list), so
// equal lengths always mean equal values. Rounded only on the data end: two
// close lengths are easier to compare against a flat origin.
export default function BarRow({ label, magnitude, max, color, valueLabel }: {
  label: string;
  magnitude: number;
  max: number;
  color?: string;
  valueLabel: ReactNode;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (magnitude / max) * 100)) : 0;
  return (
    <div className="bar-row" style={{ marginBottom: 12 }}>
      <div className="between"><b>{label}</b>{valueLabel}</div>
      <div className="bar-row-track" style={{ marginTop: 7 }}>
        <div className="bar-row-fill" style={{ width: `${pct}%`, background: color || "var(--brand)" }} />
      </div>
    </div>
  );
}
