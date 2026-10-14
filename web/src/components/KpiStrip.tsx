import type { ReactNode } from "react";
import { dotColumns, type Tone } from "../domain/visual";

export interface KpiItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone: Tone;
  // Recent per-period values (oldest first) for the dot-matrix sparkline;
  // omit to show the number alone.
  series?: number[];
  seriesLabel?: string;
}

// A row of KPI cards: label, big number and a dot-matrix sparkline in the
// card's tone. Four or five per row; more belongs under "More metrics".
export default function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="kpi-strip">
      {items.map(item => (
        <section className={`kpi-tile tone-${item.tone}`} key={item.label}>
          <div className="kpi-tile-text">
            <span className="kpi-tile-label">{item.label}</span>
            <span className="kpi-tile-value">{item.value}</span>
            {item.hint && <span className="kpi-tile-hint">{item.hint}</span>}
          </div>
          {item.series && <DotMatrixSparkline values={item.series} label={item.seriesLabel || `${item.label} trend`} />}
        </section>
      ))}
    </div>
  );
}

// Columns of dots filled from the bottom in proportion to each period. A
// decorative summary (the numbers live elsewhere), so screen readers get one
// labeled image, not 50 circles.
export function DotMatrixSparkline({ values, rows = 5, columns = 10, label }: { values: number[]; rows?: number; columns?: number; label: string }) {
  const filled = dotColumns(values, rows, columns);
  const gap = 7;
  const r = 2.6;
  const width = columns * gap;
  const height = rows * gap;
  return (
    <svg className="dot-matrix" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {filled.map((count, c) =>
        Array.from({ length: rows }).map((_, row) => {
          const fromBottom = rows - 1 - row;
          return (
            <circle
              key={`${c}-${row}`}
              cx={c * gap + gap / 2}
              cy={row * gap + gap / 2}
              r={r}
              className={fromBottom < count ? "dot on" : "dot"}
            />
          );
        })
      )}
    </svg>
  );
}
