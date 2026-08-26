import type { ReactNode } from "react";

// One labeled magnitude bar, scaled against `max` (the largest value in the
// same list) rather than a fixed multiplier — so two rows are only ever the
// same length when their values actually are. Shared by Dashboard's
// "Pipeline by stage" and Reports' "Revenue by service"/"Ad performance"
// campaign rows, which all had their own slightly-different, in one case
// wrongly-scaled, copy of this same bar before.
export default function BarRow({ label, magnitude, max, color, valueLabel }: {
  label: string;
  magnitude: number;
  max: number;
  color?: string;
  valueLabel: ReactNode;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (magnitude / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="between"><b>{label}</b>{valueLabel}</div>
      <div style={{ height: 8, background: "var(--soft)", borderRadius: 999, marginTop: 7 }}>
        <div style={{ width: `${pct}%`, height: 8, background: color || "var(--brand)", borderRadius: 999 }} />
      </div>
    </div>
  );
}
