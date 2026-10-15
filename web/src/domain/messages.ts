// Display helpers for Messages: day separators, short times, avatars.
import { TONES, type Tone } from "./visual";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// 0 = today, 1 = yesterday, ... (local time).
export function daysAgo(iso: string, now = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86400000);
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "Today" / "Yesterday" / "Mon, Oct 13" (year only when it isn't this year).
export function dayLabel(iso: string, locale: string, words: { today: string; yesterday: string }, now = new Date()): string {
  const ago = daysAgo(iso, now);
  if (ago === 0) return words.today;
  if (ago === 1) return words.yesterday;
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function clockTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

// Inbox list: the time today, "Yesterday", else a short date.
export function listTime(iso: string, locale: string, yesterday: string, now = new Date()): string {
  const ago = daysAgo(iso, now);
  if (ago === 0) return clockTime(iso, locale);
  if (ago === 1) return yesterday;
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}) });
}

export function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// The same person always gets the same color.
export function avatarTone(seed: string): Tone {
  // FNV-1a: spreads similar names across the palette, unlike a plain *31.
  let h = 2166136261;
  for (const ch of String(seed || "")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return TONES[(h >>> 0) % TONES.length];
}
