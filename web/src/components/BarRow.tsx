import type { ReactNode } from "react";

// One labeled magnitude bar, scaled against `max` (the largest value in the
// same list) rather than a fixed multiplier — so two rows are only ever the
// same length when their values actually are. Shared by Dashboard's
// "Pipeline by stage" and Reports' "Revenue by service"/"Ad performance"
// campaign rows, which all had their own slightly-different, in one case
// wrongly-scaled, copy of this same bar before.
//
// The fill is rounded only on its trailing (data) edge, flat at the origin —
// a fully-rounded pill on both ends makes two close bar lengths harder to
// compare against each other. `title` is a plain-string tooltip (each caller
// already has the exact formatted value on hand); .bar-row's hover state
// gives the bar itself some visual feedback, since a hover-only interaction
// with no visible response otherwise reads as broken, not as "there's a
// tooltip here."
export default function BarRow({ label, magnitude, max, color, valueLabel, title }: {
  label: string;
  magnitude: number;
  max: number;
  color?: string;
  valueLabel: ReactNode;
  title?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (magnitude / max) * 100)) : 0;
  return (
    <div className="bar-row" style={{ marginBottom: 12 }} title={title}>
      <div className="between"><b>{label}</b>{valueLabel}</div>
      <div className="bar-row-track" style={{ marginTop: 7 }}>
        <div className="bar-row-fill" style={{ width: `${pct}%`, background: color || "var(--brand)" }} />
      </div>
    </div>
  );
}
