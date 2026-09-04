import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TrendPoint } from "../domain/trend";

const HEIGHT = 180;
const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const PAD_TOP = 18;
const PAD_BOTTOM = 24;

// Measures the container in real CSS pixels (not viewBox units scaled down
// from a fixed constant) so stroke width and font size stay legible at any
// width — critical on a phone-width card, where a fixed-viewBox chart would
// shrink its text along with everything else.
function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

// Single-series trend line — no legend (one color, the card title already
// names it), a crosshair + tooltip that works on tap as well as hover, an
// always-visible end label (marks-and-anatomy.md: "lines -> value at the
// end"), and a table-view twin for the WCAG-clean equivalent. Line color is
// `var(--brand)`, which is already the signed-in company's own accent
// (Shell.tsx sets --company-color per company) — a single series needs no
// palette validation, there's nothing for it to collide with.
export default function TrendLineChart({ data, valueFormat = String }: { data: TrendPoint[]; valueFormat?: (n: number) => string }) {
  const [containerRef, width] = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!data.length) return <div className="empty">No data yet</div>;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxValue = Math.max(1, ...data.map(d => d.value));
  const niceMax = niceCeiling(maxValue);

  const xAt = (i: number) => PAD_LEFT + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => PAD_TOP + plotH - (v / niceMax) * plotH;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yAt(d.value).toFixed(2)}`).join(" ");
  const baseline = PAD_TOP + plotH;
  const areaPath = `${linePath} L ${xAt(data.length - 1).toFixed(2)} ${baseline.toFixed(2)} L ${xAt(0).toFixed(2)} ${baseline.toFixed(2)} Z`;

  const gridSteps = [0, 0.5, 1].map(f => niceMax * f);
  const labelIdxs = data.length <= 5
    ? data.map((_, i) => i)
    : Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  function nearestIndex(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    const relX = rect ? clientX - rect.left : 0;
    let closest = 0;
    let closestDist = Infinity;
    data.forEach((_, i) => {
      const dist = Math.abs(xAt(i) - relX);
      if (dist < closestDist) { closest = i; closestDist = dist; }
    });
    return closest;
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    setHoverIndex(nearestIndex(e.clientX));
  }

  function handleKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight") { e.preventDefault(); setHoverIndex(i => Math.min(data.length - 1, (i ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setHoverIndex(i => Math.max(0, (i ?? data.length) - 1)); }
    else if (e.key === "Escape") setHoverIndex(null);
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const last = data[data.length - 1];

  return (
    <div className="trend-chart">
      <div className="trend-chart-plot" ref={containerRef}>
        {width > 0 && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width="100%"
            height={HEIGHT}
            role="img"
            aria-label={`Trend chart, ${data.length} points, latest ${last.label} ${valueFormat(last.value)}`}
            tabIndex={0}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            onKeyDown={handleKeyDown}
          >
            {gridSteps.map((v, i) => (
              <line key={i} x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={yAt(v)} y2={yAt(v)} className="trend-chart-grid" />
            ))}
            {gridSteps.map((v, i) => (
              <text key={i} x={PAD_LEFT} y={yAt(v) - 4} className="trend-chart-axis-label">{valueFormat(Math.round(v))}</text>
            ))}
            <path d={areaPath} className="trend-chart-area" />
            <path d={linePath} className="trend-chart-line" />
            {hoverIndex !== null && (
              <line x1={xAt(hoverIndex)} x2={xAt(hoverIndex)} y1={PAD_TOP} y2={baseline} className="trend-chart-crosshair" />
            )}
            {data.map((d, i) => {
              const isLast = i === data.length - 1;
              const isHovered = i === hoverIndex;
              if (!isLast && !isHovered) return null;
              return (
                <g key={i}>
                  <circle cx={xAt(i)} cy={yAt(d.value)} r={6} className="trend-chart-dot-ring" />
                  <circle cx={xAt(i)} cy={yAt(d.value)} r={4} className="trend-chart-dot" />
                </g>
              );
            })}
            {labelIdxs.map(i => (
              <text
                key={i}
                x={xAt(i)}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="trend-chart-axis-label"
              >
                {data[i].label}
              </text>
            ))}
          </svg>
        )}
        {hovered && hoverIndex !== null && (
          <div
            className="trend-chart-tooltip"
            style={{ left: `${width ? (xAt(hoverIndex) / width) * 100 : 50}%` }}
          >
            <div className="trend-chart-tooltip-value">{valueFormat(hovered.value)}</div>
            <div className="trend-chart-tooltip-label">{hovered.label}</div>
          </div>
        )}
      </div>
      <div className="between" style={{ marginTop: 4 }}>
        <span className="sub">{last.label}: <b style={{ color: "var(--ink)" }}>{valueFormat(last.value)}</b></span>
        <button className="link-btn" onClick={() => setShowTable(v => !v)}>{showTable ? "Hide table" : "View as table"}</button>
      </div>
      {showTable && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Period</th><th>Value</th></tr></thead>
            <tbody>
              {data.map((d, i) => <tr key={i}><td>{d.label}</td><td>{valueFormat(d.value)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
