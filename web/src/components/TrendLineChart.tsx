import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { monotonePath, niceCeiling, periodChange, tickIndexes } from "../domain/chartPath";
import type { TrendPoint } from "../domain/trend";
import { useT } from "../i18n/I18nContext";

const HEIGHT = 220;
const PAD_LEFT = 2;
const PAD_RIGHT = 2;
const PAD_TOP = 24;
const PAD_BOTTOM = 26;
const EASE = [0.2, 0, 0, 1] as const;
const FOLLOW = { type: "spring", stiffness: 520, damping: 42, mass: 0.6 } as const;

// Measured in real CSS pixels, so stroke and text stay legible at any width.
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

// Single-series area chart: no legend (the card title names the series), a
// monotone curve that never dips below zero, a 10%-to-0 wash, hairline grid,
// a label on the last value, a crosshair and tooltip on hover, tap or arrow
// keys, and a table view of the same numbers. The line is the company color
// darkened a step so a light color still reaches 3:1 on the card. The
// entrance motion is skipped under prefers-reduced-motion.
export default function TrendLineChart({ data, valueFormat = String, unit }: {
  data: TrendPoint[];
  valueFormat?: (n: number) => string;
  // Singular/plural noun for the summary line, e.g. ["lead", "leads"].
  unit?: [string, string];
}) {
  const [containerRef, width] = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const { t } = useT();

  if (!data.length) return <div className="empty-state">{t("common.noData")}</div>;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const values = data.map(d => d.value);
  const niceMax = niceCeiling(Math.max(1, ...values));
  const baseline = PAD_TOP + plotH;

  const xAt = (i: number) => PAD_LEFT + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => PAD_TOP + plotH - (v / niceMax) * plotH;

  const points = data.map((d, i) => ({ x: xAt(i), y: yAt(d.value) }));
  const linePath = monotonePath(points);
  const areaPath = `${linePath}L${xAt(data.length - 1).toFixed(2)},${baseline}L${xAt(0).toFixed(2)},${baseline}Z`;
  const gridSteps = [0, 0.5, 1].map(f => niceMax * f);
  const xTicks = tickIndexes(data.length, width < 420 ? 3 : 5);

  const total = values.reduce((a, b) => a + b, 0);
  const change = periodChange(values);
  const half = Math.floor(values.length / 2);
  const last = data[data.length - 1];
  const lastIdx = data.length - 1;
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const noun = unit ? (total === 1 ? unit[0] : unit[1]) : "";

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
    if (e.key === "ArrowRight") { e.preventDefault(); setHoverIndex(i => Math.min(lastIdx, (i ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setHoverIndex(i => Math.max(0, (i ?? data.length) - 1)); }
    else if (e.key === "Escape") setHoverIndex(null);
  }

  const draw = reduceMotion ? { duration: 0 } : { duration: 0.9, ease: EASE };
  const follow = reduceMotion ? { duration: 0 } : FOLLOW;
  const markerIdx = hoverIndex ?? lastIdx;

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="trend-chart">
        <div className="trend-chart-summary">
          <span className="trend-chart-total">{valueFormat(total)}</span>
          {unit && <span className="trend-chart-noun">{t("chart.inWeeks", { noun, weeks: data.length })}</span>}
          {change.pct !== null && (
            <span className={`badge-tone ${change.pct >= 0 ? "tone-green" : "tone-rose"}`} title={t("chart.compareTitle", { weeks: half, recent: change.recent, previous: change.previous })}>
              {change.pct >= 0 ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
              {t("chart.vsPrevious", { pct: `${change.pct >= 0 ? "+" : ""}${change.pct}`, weeks: half })}
            </span>
          )}
        </div>

        <div className="trend-chart-plot" ref={containerRef}>
          {width > 0 && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              width="100%"
              height={HEIGHT}
              role="img"
              aria-label={t("chart.aria", { count: data.length, label: last.label, value: valueFormat(last.value) })}
              tabIndex={0}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerMove}
              // A mouse click shouldn't draw the keyboard focus ring; Tab still does.
              onMouseDown={e => e.preventDefault()}
              onPointerLeave={() => setHoverIndex(null)}
              onKeyDown={handleKeyDown}
              onBlur={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className="trend-chart-wash-top" />
                  <stop offset="100%" className="trend-chart-wash-bottom" />
                </linearGradient>
              </defs>

              {gridSteps.map((v, i) => (
                <g key={i}>
                  <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={yAt(v)} y2={yAt(v)} className="trend-chart-grid" />
                  {/* Whole-number labels only: with a max of 1 the 0.5 line would round to a second "1". */}
                  {i > 0 && Number.isInteger(v) && <text x={PAD_LEFT} y={yAt(v) - 6} className="trend-chart-axis-label">{valueFormat(v)}</text>}
                </g>
              ))}

              <m.path
                key={`area-${linePath}`}
                d={areaPath}
                fill={`url(#${gradientId})`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.35, ease: EASE }}
              />
              <m.path
                key={`line-${linePath}`}
                d={linePath}
                className="trend-chart-line"
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={draw}
              />

              <AnimatePresence>
                {hoverIndex !== null && (
                  <m.line
                    key="crosshair"
                    y1={PAD_TOP - 8}
                    y2={baseline}
                    x1={0}
                    x2={0}
                    className="trend-chart-crosshair"
                    initial={{ opacity: 0, x: xAt(hoverIndex) }}
                    animate={{ opacity: 1, x: xAt(hoverIndex) }}
                    exit={{ opacity: 0 }}
                    transition={follow}
                  />
                )}
              </AnimatePresence>

              {/* The end marker (or the hovered week's), with a 2px surface ring. */}
              <m.g
                initial={{ opacity: 0, x: xAt(markerIdx), y: yAt(data[markerIdx].value) }}
                animate={{ opacity: 1, x: xAt(markerIdx), y: yAt(data[markerIdx].value) }}
                transition={hoverIndex === null && !reduceMotion ? { opacity: { delay: 0.8, duration: 0.25 }, default: follow } : follow}
              >
                <circle r={6} className="trend-chart-dot-ring" />
                <circle r={4} className="trend-chart-dot" />
              </m.g>

              {/* Direct label at the end only (never a number on every point). */}
              {hoverIndex === null && (
                <m.text
                  x={xAt(lastIdx) - 10}
                  y={yAt(last.value) - 12}
                  textAnchor="end"
                  className="trend-chart-end-label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={reduceMotion ? { duration: 0 } : { delay: 0.85, duration: 0.25 }}
                >
                  {valueFormat(last.value)}
                </m.text>
              )}

              {xTicks.map(i => (
                <text
                  key={i}
                  x={xAt(i)}
                  y={HEIGHT - 6}
                  textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
                  className="trend-chart-axis-label"
                >
                  {data[i].label}
                </text>
              ))}
            </svg>
          )}

          <AnimatePresence>
            {hovered && hoverIndex !== null && (
              <m.div
                key="tooltip"
                className="trend-chart-tooltip-anchor"
                initial={{ opacity: 0, x: xAt(hoverIndex), y: yAt(hovered.value) }}
                animate={{ opacity: 1, x: xAt(hoverIndex), y: yAt(hovered.value) }}
                exit={{ opacity: 0 }}
                transition={follow}
              >
                {/* Floats just above the hovered point; flips below it when the
                    point is near the top, and hugs the side near either edge. */}
                <div className={`trend-chart-tooltip${yAt(hovered.value) < PAD_TOP + 56 ? " below" : ""}${hoverIndex > lastIdx * 0.8 ? " align-end" : hoverIndex < lastIdx * 0.2 ? " align-start" : ""}`}>
                  <span className="trend-chart-tooltip-value">{valueFormat(hovered.value)}{unit ? ` ${hovered.value === 1 ? unit[0] : unit[1]}` : ""}</span>
                  <span className="trend-chart-tooltip-label">{t("chart.weekEnding", { date: hovered.label })}</span>
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </div>

        <div className="trend-chart-foot">
          <button className="link-btn" onClick={() => setShowTable(v => !v)} aria-expanded={showTable}>{showTable ? t("common.hideTable") : t("common.viewAsTable")}</button>
        </div>
        {showTable && (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>{t("chart.weekEndingCol")}</th><th>{t("common.value")}</th></tr></thead>
              <tbody>
                {data.map((d, i) => <tr key={i}><td>{d.label}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{valueFormat(d.value)}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LazyMotion>
  );
}
