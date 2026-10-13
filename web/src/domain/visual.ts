// Pure helpers behind the redesign's visual language (KpiStrip dot-matrix
// sparklines, pastel tones per pipeline stage, readable text on the
// company accent). No React, so they're unit-tested in visual.test.ts.

// The pastel families every KPI, stage badge and progress pill picks from.
// CSS defines --tone-<name>-bg / -fg for each (styles.css, "Redesign tokens").
export const TONES = ["amber", "blue", "coral", "purple", "green", "teal", "rose", "slate"] as const;
export type Tone = typeof TONES[number];

// Stable tone per pipeline stage: won/lost always read as green/rose no
// matter where they sit; open stages walk the palette in board order.
export function stageTone(stage: { id: string; type?: string | null }, index: number): Tone {
  if (stage.type === "won") return "green";
  if (stage.type === "lost") return "rose";
  const open: Tone[] = ["slate", "blue", "amber", "purple", "teal", "coral"];
  return open[index % open.length];
}

// Dot-matrix sparkline: one column per recent period, `rows` dots tall,
// with the number of filled dots proportional to that period's value
// against the largest one shown. Any non-zero value fills at least one dot,
// so "a little" never looks the same as "nothing".
export function dotColumns(values: number[], rows = 5, columns = 10): number[] {
  const recent = values.slice(-columns);
  const padded = [...Array(Math.max(0, columns - recent.length)).fill(0), ...recent];
  const max = Math.max(0, ...padded);
  if (max <= 0) return padded.map(() => 0);
  return padded.map(v => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * rows))));
}

// White or near-black text, whichever contrasts more with `hex` (WCAG
// relative luminance). The accent is each company's own color, so it can't
// be assumed dark enough for white text — Peach Fresh's coral isn't.
export function readableOn(hex: string | null | undefined): "#ffffff" | "#111111" {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4]
    .map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onWhite = 1.05 / (lum + 0.05);
  const onBlack = (lum + 0.05) / (0.0056 + 0.05); // #111 ≈ 0.0056 luminance
  return onWhite >= onBlack ? "#ffffff" : "#111111";
}

// Two-letter avatar initials for the account menu.
export function avatarInitials(name: string | null | undefined, fallback = "?"): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
