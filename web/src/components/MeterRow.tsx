import type { ReactNode } from "react";
import type { Tone } from "../domain/visual";
import ProgressPill from "./ProgressPill";

// One labeled magnitude row: tone dot + label, a ProgressPill scaled
// against `max` (the largest value in the same list), and the value on the
// right in the text color (never the tone — text wears text tokens).
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
