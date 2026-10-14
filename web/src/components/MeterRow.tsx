import type { ReactNode } from "react";
import type { Tone } from "../domain/visual";
import ProgressPill from "./ProgressPill";

// A labeled row: tone dot, label, a ProgressPill scaled against `max` (the
// largest value in its list) and the value in the text color.
export default function MeterRow({ label, value, max, tone, valueLabel, ariaLabel }: {
  label: string;
  value: number;
  max: number;
  tone: Tone;
  valueLabel: ReactNode;
  ariaLabel: string;
}) {
  return (
    <div className={`meter-row tone-${tone}`}>
      <span className="meter-row-label" title={label}>{label}</span>
      <ProgressPill value={value} max={max} tone={tone} label={ariaLabel} />
      <span className="meter-row-value">{valueLabel}</span>
    </div>
  );
}
