// Server-rendered HTML for the public booking page, its two legal pages and
// the small message pages (unsubscribe, not found). Plain template strings —
// the page has to be fast on a phone, indexable, and work with JavaScript
// off, and it must not pull in the CRM bundle (or anything that knows about
// Supabase keys). Every interpolated value goes through esc().
//
// The booking form is one <form> split into four steps. Without JavaScript
// all four show stacked and it submits like any form; with it (bookingClient
// below) it becomes a one-step-at-a-time flow with a calendar, a live
// summary and per-step checks. The server validates everything either way.
import { HEARD_FROM_OPTIONS, HONEYPOT_FIELD, PERIODS, UTM_FIELDS, activeServices } from "./bookingForm.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// White or near-black text, whichever contrasts more with the brand color —
// the color comes from the company record, so it can't be assumed dark.
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.05) ? "#ffffff" : "#111827";
}

const safeUrl = url => (/^https:\/\//i.test(String(url || "")) || /^\/[^/]/.test(String(url || "")) ? String(url) : "");
const telHref = phone => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;
const fullAddress = p => [p.address_line, p.address_city, [p.address_state, p.address_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const jsonLd = obj => JSON.stringify(obj).replace(/</g, "\\u003c");
const initials = name => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// The SMS consent text mentions "SMS Terms" and "Privacy Policy" — linked on
// the page, while consent_records.text_shown keeps the plain sentence.
export function linkifyConsent(text, base) {
  return esc(text)
    .replace("SMS Terms", `<a href="${esc(base)}/sms-terms" target="_blank" rel="noopener">SMS Terms</a>`)
    .replace("Privacy Policy", `<a href="${esc(base)}/privacy" target="_blank" rel="noopener">Privacy Policy</a>`);
}

// ── Icons (24px, stroke) ─────────────────────────────────────────────────
const ICON_PATHS = {
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 3v4 M21 5h-4 M5 17v3 M6.5 18.5h-3",
  repeat: "M17 2l4 4-4 4 M3 11v-1a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v1a4 4 0 0 1-4 4H3",
  box: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8",
  building: "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16 M16 9h2a2 2 0 0 1 2 2v10 M3 21h18 M8 7h4 M8 11h4 M8 15h4",
  cabinet: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M12 3v18 M9.5 10v3 M14.5 10v3",
  drop: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
  brush: "M18 2l4 4-9.5 9.5-4-4z M8.5 11.5C6 12 4.5 14 4.5 17c0 1.5-1 2.5-2.5 3 2.5 1 6.5.5 8-1 1.5-1.5 2-3.5 2.5-4.5",
  ruler: "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2",
  layers: "M12 2l10 5-10 5L2 7z M2 12l10 5 10-5 M2 17l10 5 10-5",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  calendar: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M16 2v4 M8 2v4 M3 10h18",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4",
  sunset: "M17 18a5 5 0 0 0-10 0 M12 2v7 M4.2 10.2l1.4 1.4 M1 18h2 M21 18h2 M18.4 11.6l1.4-1.4 M23 22H1 M8 6l4-4 4 4",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2",
  pin: "M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  check: "M20 6L9 17l-5-5",
  arrowRight: "M5 12h14 M12 5l7 7-7 7",
  arrowLeft: "M19 12H5 M12 19l-7-7 7-7",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z M2 10h20"
};

function icon(name, cls = "") {
  const d = ICON_PATHS[name] || ICON_PATHS.sparkles;
  return `<svg class="ic${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d.split(" M").map((seg, i) => `<path d="${i ? "M" : ""}${seg}"/>`).join("")}</svg>`;
}

// A service's icon, guessed from its name — the services are whatever the
// company typed in the CRM, so this matches on words, with a default.
const SERVICE_ICON_RULES = [
  [/recurr|weekly|monthly|regular/i, "repeat"],
  [/move|moving/i, "box"],
  [/commercial|office|business/i, "building"],
  [/vanit|bath/i, "drop"],
  [/refac|refinish|paint|stain/i, "brush"],
  [/custom|build|design/i, "ruler"],
  [/tile|backsplash|carpet|rug/i, "grid"],
  [/floor|install|lvp|hardwood|laminate/i, "layers"],
  [/cabinet|kitchen|closet|pantry/i, "cabinet"],
  [/clean|deep|maid/i, "sparkles"]
];
export const serviceIcon = name => (SERVICE_ICON_RULES.find(([re]) => re.test(name)) || [null, "sparkles"])[1];

const TONES = ["amber", "blue", "coral", "purple", "green", "teal", "rose"];

const PERIOD_INFO = {
  "": { label: "Flexible", sub: "Whatever works best", icon: "clock" },
  morning: { label: PERIODS.morning, sub: "Before noon", icon: "sun" },
  afternoon: { label: PERIODS.afternoon, sub: "After noon", icon: "sunset" }
};

// ── Styles ───────────────────────────────────────────────────────────────
// The CRM's look: warm off-white canvas, white rounded cards, pastel tones,
// pill buttons, Outfit. The company color is the accent.
const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:"Outfit",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5;color:var(--ink-soft);background:var(--bg);background-image:radial-gradient(1100px 560px at 90% -10%,var(--brand-glow),transparent 60%),radial-gradient(900px 500px at -10% 0%,rgba(255,255,255,.95),transparent 60%);background-attachment:fixed;min-height:100vh}
a{color:inherit}
img{max-width:100%;height:auto}
h1,h2,h3{color:var(--ink);font-weight:600;letter-spacing:-.015em;margin:0}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:16px;background:#fff;padding:8px 12px;z-index:10;border-radius:12px}
:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
.ic{width:20px;height:20px;flex:0 0 auto}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* Top bar */
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--surface);backdrop-filter:blur(12px);border-radius:999px;padding:8px 10px 8px 8px;box-shadow:var(--shadow-sm)}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font-weight:600;font-size:17px;min-width:0}
.brand-mark{width:42px;height:42px;border-radius:999px;background:#fff;display:grid;place-items:center;overflow:hidden;box-shadow:0 0 0 1px var(--line);flex:0 0 auto}
.brand-mark img{width:80%;height:80%;object-fit:contain}
.brand-mark b{font-size:15px;color:var(--brand-ink-soft)}
.brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill-link{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:0 16px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:500;font-size:15px;white-space:nowrap}
.pill-link .ic{width:17px;height:17px}

/* Hero */
.hero{padding:28px 0 8px;display:grid;gap:18px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;width:max-content;max-width:100%;padding:6px 14px 6px 8px;border-radius:999px;background:var(--surface);box-shadow:var(--shadow-xs);font-size:14px;color:var(--ink-soft)}
.eyebrow .dot{width:22px;height:22px;border-radius:999px;background:var(--brand);color:var(--on-brand);display:grid;place-items:center}
.eyebrow .dot .ic{width:13px;height:13px}
.hero h1{font-size:clamp(34px,7.5vw,60px);line-height:1.02;letter-spacing:-.03em;max-width:13ch}
.hero h1 em{font-style:normal;color:var(--brand-ink)}
.hero p.lead{font-size:clamp(17px,2.4vw,20px);color:var(--muted);margin:0;max-width:52ch}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:4px 0 0;padding:0}
.chips li{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:var(--surface);font-size:14px;color:var(--ink-soft);box-shadow:var(--shadow-xs)}
.chips .ic{width:16px;height:16px;color:var(--brand-ink)}

/* Booking card + summary */
.booker{display:grid;gap:16px;padding:20px 0 8px;align-items:start}
.card{background:var(--surface-solid);border-radius:28px;box-shadow:var(--shadow-md)}
.form-card{padding:22px 18px 20px;min-width:0}
.stepper{list-style:none;margin:0 0 6px;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.stepper li{display:grid;gap:8px;font-size:13px;color:var(--muted)}
.stepper .bar{height:6px;border-radius:999px;background:var(--soft);overflow:hidden}
.stepper .bar i{display:block;height:100%;width:0;background:var(--brand);border-radius:inherit;transition:width .35s var(--ease)}
.stepper li.done .bar i,.stepper li.current .bar i{width:100%}
.stepper li.current{color:var(--ink);font-weight:600}
.stepper .num{display:none}
.no-js .stepper{display:none}
.step{border:0;margin:0;padding:18px 0 0;min-width:0}
.step + .step{border-top:1px solid var(--line);margin-top:22px}
.js .step + .step{border-top:0;margin-top:0}
.js .step[hidden]{display:none}
.js .step.enter{animation:stepIn .32s var(--ease) both}
.js .step.enter.back{animation-name:stepBack}
@keyframes stepIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes stepBack{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.step-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
.step-h .badge{width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand-ink);flex:0 0 auto}
.step-h h2{font-size:clamp(21px,3.4vw,26px);outline:none}
.step-h p{margin:2px 0 0;color:var(--muted);font-size:15px}

/* Service tiles */
.tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(136px,1fr))}
.tile{position:relative;display:grid;gap:12px;align-content:start;min-height:112px;padding:16px;border-radius:20px;background:var(--tile-bg);cursor:pointer;transition:transform .18s var(--ease),box-shadow .18s var(--ease);box-shadow:inset 0 0 0 2px transparent}
.tile:hover{transform:translateY(-2px)}
.tile input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.tile .t-ic{width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.75);display:grid;place-items:center;color:var(--tile-fg)}
.tile .t-name{font-weight:600;color:var(--ink);font-size:16px;line-height:1.25}
.tile .t-check{position:absolute;top:12px;right:12px;width:26px;height:26px;border-radius:999px;background:rgba(255,255,255,.8);display:grid;place-items:center;color:transparent;transition:all .18s var(--ease)}
.tile .t-check .ic{width:15px;height:15px}
.tile:has(input:checked){box-shadow:inset 0 0 0 2px var(--ink)}
.tile:has(input:checked) .t-check{background:var(--ink);color:#fff;transform:scale(1.05)}
.tile:has(input:focus-visible){outline:3px solid var(--ring);outline-offset:2px}

/* Calendar */
.cal{display:none}
.js .cal{display:block;background:var(--soft-2);border-radius:22px;padding:14px}
.cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cal-head b{font-size:17px;color:var(--ink);font-weight:600}
.cal-nav{display:flex;gap:6px}
.round{width:40px;height:40px;border-radius:999px;border:0;background:#fff;display:grid;place-items:center;cursor:pointer;color:var(--ink);box-shadow:var(--shadow-xs)}
.round:disabled{opacity:.35;cursor:default}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.cal-dow{font-size:12px;color:var(--muted);padding:4px 0;font-weight:500}
.day{height:44px;border:0;border-radius:14px;background:transparent;font:inherit;font-size:15px;color:var(--ink);cursor:pointer;position:relative;transition:background .15s var(--ease),transform .15s var(--ease)}
.day:hover:not(:disabled){background:#fff}
.day:disabled{color:var(--muted-soft);cursor:default}
.day.today::after{content:"";position:absolute;left:50%;bottom:6px;width:4px;height:4px;margin-left:-2px;border-radius:999px;background:var(--brand)}
.day[aria-pressed=true]{background:var(--ink);color:#fff;transform:scale(1.04)}
.day[aria-pressed=true]::after{background:#fff}
.date-native{margin-top:0}
.js .date-native{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.date-pick{margin-top:10px;font-size:15px;color:var(--muted);min-height:22px}
.date-pick b{color:var(--ink);font-weight:600}
.link-btn{background:none;border:0;padding:0;font:inherit;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.sub-h{font-size:15px;font-weight:600;color:var(--ink);margin:20px 0 10px}

/* Period tiles */
.periods{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.period{position:relative;display:grid;justify-items:center;text-align:center;gap:4px;padding:14px 8px;border-radius:18px;background:var(--soft-2);cursor:pointer;box-shadow:inset 0 0 0 2px transparent;transition:box-shadow .18s var(--ease)}
.period input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.period .ic{width:22px;height:22px;color:var(--brand-ink)}
.period b{font-weight:600;color:var(--ink);font-size:15px}
.period span{font-size:12.5px;color:var(--muted)}
.period:has(input:checked){background:#fff;box-shadow:inset 0 0 0 2px var(--ink)}
.period:has(input:focus-visible){outline:3px solid var(--ring);outline-offset:2px}

/* Fields */
.grid{display:grid;gap:14px;grid-template-columns:1fr}
.field{display:grid;gap:6px;min-width:0}
.field label{font-weight:500;color:var(--ink);font-size:15px}
.req{color:var(--danger)}
.hint{font-size:13.5px;color:var(--muted)}
input[type=text],input[type=tel],input[type=email],input[type=date],select,textarea{width:100%;min-height:52px;padding:12px 16px;font:inherit;font-size:16px;color:var(--ink);background:var(--soft-2);border:2px solid transparent;border-radius:16px;transition:border-color .15s var(--ease),background .15s var(--ease)}
input:focus,select:focus,textarea:focus{outline:none;background:#fff;border-color:var(--brand)}
textarea{min-height:100px;resize:vertical}
select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236f6b62' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;padding-right:42px}
[aria-invalid=true]{border-color:var(--danger)!important;background:#fff}
.err{color:var(--danger);font-size:14px;font-weight:500;margin:0}
.group-err{margin-top:10px}

/* Consent */
.consent{display:grid;gap:10px;margin-top:20px}
.consent-h{font-size:15px;font-weight:600;color:var(--ink);margin:0}
.consent-h span{font-weight:400;color:var(--muted)}
.opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:18px;background:var(--soft-2);cursor:pointer}
.opt input{width:22px;height:22px;margin:1px 0 0;flex:0 0 auto;accent-color:var(--ink);cursor:pointer}
.opt label{font-size:13.5px;line-height:1.5;color:var(--ink-soft);cursor:pointer}
.opt:has(input:checked){background:var(--brand-soft)}
.notice{font-size:13px;color:var(--muted);margin:12px 0 0}

/* Step navigation */
.step-nav{display:none}
.js .step-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:22px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:54px;padding:0 26px;border-radius:999px;border:0;background:var(--brand);color:var(--on-brand);font:inherit;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .15s var(--ease),filter .15s var(--ease)}
.btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.btn:active{transform:none}
.btn .ic{width:18px;height:18px}
.btn.ghost{background:transparent;color:var(--ink);padding:0 14px}
.btn.ghost:hover{background:var(--soft-2);transform:none}
.btn.dark{background:var(--ink);color:#fff}
.btn[disabled]{opacity:.7;cursor:progress}
.btn.wide{flex:1}
.submit-row{margin-top:22px}
.js .submit-row{margin-top:0}
.no-js .step-nav-final{display:none}
.spin{width:18px;height:18px;border-radius:999px;border:2.5px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Alerts */
.alert{border-radius:20px;padding:14px 16px;margin-bottom:6px;background:var(--danger-soft);color:var(--danger-ink)}
.alert h3{margin:0 0 4px;font-size:16px;color:var(--danger-ink)}
.alert p{margin:0}
.alert ul{margin:6px 0 0;padding-left:20px}

/* Summary */
.summary{padding:20px;display:grid;gap:14px}
.summary h2{font-size:18px}
.sum-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.sum-list li{display:flex;gap:12px;align-items:flex-start;padding:10px;border-radius:16px;transition:background .25s var(--ease)}
.sum-list li.flash{background:var(--brand-soft)}
.sum-list .s-ic{width:36px;height:36px;border-radius:12px;background:var(--soft-2);display:grid;place-items:center;color:var(--muted);flex:0 0 auto}
.sum-list li.filled .s-ic{background:var(--brand-soft);color:var(--brand-ink)}
.sum-list small{display:block;font-size:12.5px;color:var(--muted)}
.sum-list b{display:block;font-weight:500;color:var(--ink);font-size:15px;overflow-wrap:anywhere}
.sum-list li:not(.filled) b{color:var(--muted-soft);font-weight:400}
.no-js .sum-list{display:none}
.reassure{display:grid;gap:8px;margin:0;padding:14px;border-radius:18px;background:var(--soft-2);font-size:14px;list-style:none}
.reassure li{display:flex;gap:8px;align-items:center}
.reassure .ic{width:16px;height:16px;color:var(--brand-ink)}
.summary .call{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--muted)}
.summary .call a{color:var(--ink);font-weight:600;text-decoration:none}

/* How it works / FAQ */
.section{padding:44px 0 8px}
.section h2{font-size:clamp(26px,4.5vw,36px);letter-spacing:-.02em;margin-bottom:18px}
.how{display:grid;gap:12px;list-style:none;margin:0;padding:0;counter-reset:s}
.how li{counter-increment:s;padding:22px;border-radius:24px;background:var(--surface);box-shadow:var(--shadow-xs);display:grid;gap:6px}
.how li::before{content:counter(s);width:36px;height:36px;border-radius:999px;display:grid;place-items:center;font-weight:600;background:var(--how-bg);color:var(--how-fg);margin-bottom:6px}
.how li:nth-child(1){--how-bg:var(--tone-amber-bg);--how-fg:var(--tone-amber-fg)}
.how li:nth-child(2){--how-bg:var(--tone-blue-bg);--how-fg:var(--tone-blue-fg)}
.how li:nth-child(3){--how-bg:var(--tone-green-bg);--how-fg:var(--tone-green-fg)}
.how b{color:var(--ink);font-size:17px;font-weight:600}
.how span{color:var(--muted)}
details.faq{background:var(--surface);border-radius:20px;padding:4px 18px;margin-bottom:8px}
details.faq summary{cursor:pointer;font-weight:600;color:var(--ink);padding:14px 0}
details.faq p{margin:0 0 14px}

/* Success */
.success-card{padding:34px 22px;text-align:center;display:grid;justify-items:center;gap:10px}
.success-mark{width:88px;height:88px;border-radius:999px;background:var(--tone-green-bg);display:grid;place-items:center;animation:pop .5s var(--ease) both}
.success-mark svg{width:46px;height:46px;color:var(--tone-green-fg)}
.success-mark path{stroke-dasharray:30;stroke-dashoffset:30;animation:draw .5s .25s var(--ease) forwards}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes draw{to{stroke-dashoffset:0}}
.success-card h2{font-size:clamp(26px,5vw,34px);letter-spacing:-.02em;margin-top:6px}
.success-card p{margin:0;color:var(--muted);max-width:44ch;font-size:17px}
.timeline{list-style:none;margin:16px 0 6px;padding:0;display:grid;gap:8px;width:100%;max-width:420px;text-align:left}
.timeline li{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;background:var(--soft-2);opacity:0;animation:rise .4s var(--ease) forwards}
.timeline li:nth-child(1){animation-delay:.45s}
.timeline li:nth-child(2){animation-delay:.6s}
.timeline li:nth-child(3){animation-delay:.75s}
.timeline .t-dot{width:32px;height:32px;border-radius:999px;display:grid;place-items:center;background:#fff;color:var(--muted);flex:0 0 auto}
.timeline .t-dot .ic{width:16px;height:16px}
.timeline li.ok .t-dot{background:var(--tone-green-fg);color:#fff}
.timeline b{display:block;color:var(--ink);font-weight:600;font-size:15px}
.timeline span{font-size:13.5px;color:var(--muted)}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* Footer + legal */
footer{margin-top:48px;padding:28px 0 36px;font-size:14px;color:var(--muted)}
footer .wrap{display:grid;gap:8px}
footer b{color:var(--ink);font-weight:600}
footer .links{display:flex;flex-wrap:wrap;gap:16px}
footer a{color:var(--ink-soft)}
.legal{padding:24px 0 24px}
.legal .card{padding:28px 22px;max-width:780px}
.legal h1{font-size:clamp(28px,6vw,40px);letter-spacing:-.02em;margin:0 0 6px}
.legal h2{font-size:19px;margin:26px 0 8px}
.legal .back{display:inline-flex;align-items:center;gap:6px;margin-top:28px;color:var(--ink);font-weight:500}
.hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}

@media (min-width:640px){
  .grid.two{grid-template-columns:1fr 1fr}
  .grid.zip{grid-template-columns:2fr 1fr}
  .form-card{padding:30px 30px 26px}
  .how{grid-template-columns:repeat(3,1fr)}
  .stepper .num{display:inline}
}
@media (min-width:960px){
  .booker{grid-template-columns:minmax(0,1fr) 340px;gap:20px}
  .summary{position:sticky;top:20px}
  .hero{padding-top:40px}
}
@media (max-width:420px){
  .periods{grid-template-columns:1fr;}
  .period{grid-template-columns:auto 1fr;justify-items:start;text-align:left;column-gap:12px;padding:12px 16px}
  .period .ic{grid-row:span 2}
  .pill-link .lbl{display:none}
  .pill-link{padding:0 13px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;transition:none!important}
  html{scroll-behavior:auto}
  .success-mark path{stroke-dashoffset:0}
  .timeline li{opacity:1}
}
`;

function layout({ page, title, description, canonical, body, head = "" }) {
  const brand = page?.primary_color || "#e8a33d";
  const on = textOn(brand);
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta name="theme-color" content="#f6f4ec">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap">
<style>:root{--brand:${esc(brand)};--on-brand:${on};--brand-soft:color-mix(in srgb, ${esc(brand)} 14%, #fff);--brand-glow:color-mix(in srgb, ${esc(brand)} 22%, transparent);--brand-ink:color-mix(in srgb, ${esc(brand)} 72%, #111);--brand-ink-soft:color-mix(in srgb, ${esc(brand)} 80%, #111);--ring:color-mix(in srgb, ${esc(brand)} 45%, transparent);--bg:#f6f4ec;--ink:#111111;--ink-soft:#2a2a2a;--muted:#6f6b62;--muted-soft:#a29d92;--line:rgba(17,17,17,.07);--soft:#f1eee5;--soft-2:#f6f4ee;--surface:rgba(255,255,255,.78);--surface-solid:#fff;--danger:#b4232f;--danger-soft:#fbe4e8;--danger-ink:#7a1a26;--shadow-xs:0 1px 2px rgba(40,32,10,.05);--shadow-sm:0 1px 2px rgba(40,32,10,.04),0 6px 20px -8px rgba(40,32,10,.1);--shadow-md:0 2px 6px rgba(40,32,10,.05),0 18px 44px -18px rgba(40,32,10,.18);--ease:cubic-bezier(.2,0,0,1);--tone-amber-bg:#fdf0d5;--tone-amber-fg:#8a5a00;--tone-blue-bg:#e3edfb;--tone-blue-fg:#1f4f8f;--tone-coral-bg:#fde6df;--tone-coral-fg:#9a3a20;--tone-purple-bg:#ece6fb;--tone-purple-fg:#5a3b9e;--tone-green-bg:#e0f3e6;--tone-green-fg:#1f6b3a;--tone-teal-bg:#dcf1ef;--tone-teal-fg:#11605a;--tone-rose-bg:#fbe4e8;--tone-rose-fg:#9b2c44}${CSS}</style>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function topBar(page, base) {
  const logo = safeUrl(page.logo_url);
  return `<header class="top wrap"><div class="topbar" style="width:100%">
  <a class="brand" href="${esc(base)}"><span class="brand-mark">${logo ? `<img src="${esc(logo)}" alt="" width="34" height="34">` : `<b>${esc(initials(page.business_name))}</b>`}</span><span>${esc(page.business_name)}</span></a>
  ${page.phone ? `<a class="pill-link" href="${telHref(page.phone)}" aria-label="Call ${esc(page.phone)}">${icon("phone")}<span class="lbl">${esc(page.phone)}</span></a>` : `<a class="pill-link" href="${esc(base)}#book">${icon("calendar")}<span class="lbl">Book now</span></a>`}
</div></header>`;
}

function footer(page, base) {
  const year = new Date().getFullYear();
  const contact = [page.phone ? `<a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : "", page.email ? `<a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""].filter(Boolean).join(" · ");
  return `<footer>
  <div class="wrap">
    <b>${esc(page.business_name)}</b>
    ${fullAddress(page) ? `<address style="font-style:normal">${esc(fullAddress(page))}</address>` : ""}
    ${contact ? `<div>${contact}</div>` : ""}
    <nav class="links" aria-label="Legal">
      <a href="${esc(base)}/privacy">Privacy Policy</a>
      <a href="${esc(base)}/sms-terms">SMS Terms</a>
    </nav>
    <span>&copy; ${year} ${esc(page.business_name)}</span>
  </div>
</footer>`;
}

function field({ name, label, type = "text", required, value, error, attrs = "", hint }) {
  const id = `f_${name}`;
  const describedBy = [hint ? `${id}_hint` : "", error ? `${id}_err` : ""].filter(Boolean).join(" ");
  return `<div class="field">
  <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
  <input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}"${required ? " required" : ""}${error ? ' aria-invalid="true"' : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""} ${attrs}>
  ${hint ? `<span class="hint" id="${id}_hint">${esc(hint)}</span>` : ""}
  ${error ? `<p class="err" id="${id}_err">${esc(error)}</p>` : ""}
</div>`;
}

const FIELD_LABELS = {
  services: "Service", first_name: "First name", last_name: "Last name", phone: "Mobile phone", email: "Email",
  address: "Street address", city: "City", zip: "ZIP code", preferred_date: "Preferred date"
};

const STEPS = [
  { id: "service", label: "Service", icon: "sparkles" },
  { id: "when", label: "Date & time", icon: "calendar" },
  { id: "where", label: "Address", icon: "pin" },
  { id: "you", label: "Contact", icon: "user" }
];

function stepHead(i, title, sub) {
  return `<div class="step-h"><span class="badge">${icon(STEPS[i].icon)}</span><div><h2 id="step-${i}-h" tabindex="-1">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div></div>`;
}

function stepNav(i) {
  const back = i > 0 ? `<button type="button" class="btn ghost" data-back>${icon("arrowLeft")}Back</button>` : "<span></span>";
  if (i === STEPS.length - 1) return "";
  return `<div class="step-nav">${back}<button type="button" class="btn dark" data-next>Continue${icon("arrowRight")}</button></div>`;
}

function bookingForm({ page, base, texts, values = {}, errors = {}, utm = {}, formError, today }) {
  const services = activeServices(page);
  const selected = new Set(values.services || []);
  const errorList = Object.entries(errors);
  const detailServices = services.filter(s => s.detail_label);
  const period = values.preferred_period || "";

  return `<form class="card form-card" method="post" action="${esc(base)}" novalidate id="booking-form" data-today="${esc(today)}" aria-labelledby="book-h">
  <h2 id="book-h" class="sr-only">Book your appointment</h2>
  <ol class="stepper" aria-hidden="true">${STEPS.map((s, i) => `<li data-for="${i}"><span class="bar"><i></i></span><span><span class="num">${i + 1}. </span>${esc(s.label)}</span></li>`).join("")}</ol>
  <p class="sr-only" id="step-status" role="status" aria-live="polite"></p>

  ${formError ? `<div class="alert" role="alert"><h3>We couldn't send your request</h3><p>${esc(formError)} Your answers are still here.${page.phone ? ` You can also call us at <a href="${telHref(page.phone)}">${esc(page.phone)}</a>.` : ""}</p></div>` : ""}
  ${errorList.length ? `<div class="alert" role="alert" tabindex="-1" id="form-errors"><h3>Please check ${errorList.length === 1 ? "this" : `these ${errorList.length}`}:</h3><ul>${errorList.map(([k, msg]) => `<li><a href="#f_${esc(k)}">${esc(FIELD_LABELS[k] || "This field")}: ${esc(msg)}</a></li>`).join("")}</ul></div>` : ""}

  <fieldset class="step" data-step="0" aria-labelledby="step-0-h">
    ${stepHead(0, "What can we help with?", services.length > 1 ? "Pick one or more." : "")}
    ${services.length ? `<div class="tiles" id="f_services">
      ${services.map((s, i) => {
        const tone = TONES[i % TONES.length];
        return `<label class="tile" style="--tile-bg:var(--tone-${tone}-bg);--tile-fg:var(--tone-${tone}-fg)">
        <input type="checkbox" name="services" value="${esc(s.id)}" data-name="${esc(s.name)}"${selected.has(String(s.id)) ? " checked" : ""}${errors.services ? ' aria-invalid="true"' : ""}>
        <span class="t-ic">${icon(serviceIcon(s.name))}</span>
        <span class="t-name">${esc(s.name)}</span>
        <span class="t-check">${icon("check")}</span>
      </label>`;
      }).join("")}
    </div>
    ${errors.services ? `<p class="err group-err" id="f_services_err">${esc(errors.services)}</p>` : `<p class="err group-err" id="f_services_live" hidden>Please choose at least one service.</p>`}` : ""}
    ${detailServices.length ? `<div class="grid two" style="margin-top:14px">
      ${detailServices.map(s => field({ name: `detail_${s.id}`, label: s.detail_label, type: "text", value: values.details?.[s.id], error: errors[`detail_${s.id}`], hint: "Optional", attrs: 'inputmode="numeric" maxlength="2"' })).join("")}
    </div>` : ""}
    ${stepNav(0)}
  </fieldset>

  <fieldset class="step" data-step="1" aria-labelledby="step-1-h">
    ${stepHead(1, "When works for you?", "Pick a day you'd like — we'll confirm the exact time with you.")}
    <div class="cal" id="cal" aria-label="Choose a date">
      <div class="cal-head"><b id="cal-month"></b><div class="cal-nav"><button type="button" class="round" id="cal-prev" aria-label="Previous month">${icon("chevronLeft")}</button><button type="button" class="round" id="cal-next" aria-label="Next month">${icon("chevronRight")}</button></div></div>
      <div class="cal-grid" id="cal-grid"></div>
    </div>
    <div class="field date-native">
      <label for="f_preferred_date">Preferred date <span class="hint">(optional)</span></label>
      <input id="f_preferred_date" name="preferred_date" type="date" value="${esc(values.preferred_date)}" min="${esc(today)}"${errors.preferred_date ? ' aria-invalid="true" aria-describedby="f_preferred_date_err"' : ""}>
      ${errors.preferred_date ? `<p class="err" id="f_preferred_date_err">${esc(errors.preferred_date)}</p>` : ""}
    </div>
    <p class="date-pick" id="date-pick" aria-live="polite"></p>
    <p class="sub-h" id="period-h">Time of day</p>
    <div class="periods" role="radiogroup" aria-labelledby="period-h">
      ${Object.entries(PERIOD_INFO).map(([v, p]) => `<label class="period"><input type="radio" name="preferred_period" value="${v}"${period === v ? " checked" : ""}>${icon(p.icon)}<b>${esc(p.label)}</b><span>${esc(p.sub)}</span></label>`).join("")}
    </div>
    ${stepNav(1)}
  </fieldset>

  <fieldset class="step" data-step="2" aria-labelledby="step-2-h">
    ${stepHead(2, "Where's the job?", "The address where you'd like the service.")}
    <div class="grid">
      ${field({ name: "address", label: "Street address", required: true, value: values.address, error: errors.address, attrs: 'autocomplete="street-address" maxlength="120"' })}
    </div>
    <div class="grid two zip" style="margin-top:14px">
      ${field({ name: "city", label: "City", required: true, value: values.city, error: errors.city, attrs: 'autocomplete="address-level2" maxlength="60"' })}
      ${field({ name: "zip", label: "ZIP code", required: true, value: values.zip, error: errors.zip, attrs: 'autocomplete="postal-code" inputmode="numeric" maxlength="10" pattern="\\d{5}(-\\d{4})?"' })}
    </div>
    ${stepNav(2)}
  </fieldset>

  <fieldset class="step" data-step="3" aria-labelledby="step-3-h">
    ${stepHead(3, "How can we reach you?", "We'll text and email to confirm your appointment.")}
    <div class="grid two">
      ${field({ name: "first_name", label: "First name", required: true, value: values.first_name, error: errors.first_name, attrs: 'autocomplete="given-name" maxlength="60"' })}
      ${field({ name: "last_name", label: "Last name", required: true, value: values.last_name, error: errors.last_name, attrs: 'autocomplete="family-name" maxlength="60"' })}
      ${field({ name: "phone", label: "Mobile phone", type: "tel", required: true, value: values.phone, error: errors.phone, attrs: 'autocomplete="tel-national" inputmode="tel" maxlength="20" placeholder="(404) 555-0123"' })}
      ${field({ name: "email", label: "Email", type: "email", required: true, value: values.email, error: errors.email, attrs: 'autocomplete="email" maxlength="254" placeholder="you@example.com"' })}
    </div>
    <div class="grid" style="margin-top:14px">
      <div class="field">
        <label for="f_notes">Anything we should know? <span class="hint">(optional)</span></label>
        <textarea id="f_notes" name="notes" maxlength="2000" placeholder="Size of the space, pets, gate code, best time to call…">${esc(values.notes)}</textarea>
      </div>
      <div class="field">
        <label for="f_heard_from">How did you hear about us? <span class="hint">(optional)</span></label>
        <select id="f_heard_from" name="heard_from">
          <option value="">Choose one</option>
          ${HEARD_FROM_OPTIONS.map(o => `<option${values.heard_from === o ? " selected" : ""}>${esc(o)}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="consent" role="group" aria-labelledby="consent-h">
      <p class="consent-h" id="consent-h">Offers and updates <span>(optional — not required to book)</span></p>
      <div class="opt"><input type="checkbox" id="sms_consent" name="sms_consent" value="yes"${values.sms_consent ? " checked" : ""}><label for="sms_consent">${linkifyConsent(texts.sms.text, base)}</label></div>
      <div class="opt"><input type="checkbox" id="email_consent" name="email_consent" value="yes"${values.email_consent ? " checked" : ""}><label for="email_consent">${esc(texts.email.text)}</label></div>
    </div>

    <div class="hp" aria-hidden="true"><label for="f_${HONEYPOT_FIELD}">Leave this empty</label><input id="f_${HONEYPOT_FIELD}" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off"></div>
    <input type="hidden" name="sms_text_version" value="${esc(texts.sms.version)}">
    <input type="hidden" name="email_text_version" value="${esc(texts.email.version)}">
    <input type="hidden" name="transactional_text_version" value="${esc(texts.transactional.version)}">
    ${UTM_FIELDS.map(f => `<input type="hidden" name="${f}" value="${esc(utm[f])}">`).join("")}

    <div class="submit-row">
      <div class="step-nav step-nav-final" style="margin-top:22px"><button type="button" class="btn ghost" data-back>${icon("arrowLeft")}Back</button><span></span></div>
      <button class="btn" type="submit" id="submit-btn" style="width:100%;margin-top:14px">Request my appointment${icon("arrowRight")}</button>
      <p class="notice">${esc(texts.transactional.text)}</p>
    </div>
  </fieldset>
</form>`;
}

function summaryCard(page) {
  const rows = [
    ["services", "sparkles", "Service", "Not chosen yet"],
    ["date", "calendar", "Date", "Any day"],
    ["period", "clock", "Time", "Flexible"],
    ["address", "pin", "Address", "Not added yet"]
  ];
  return `<aside class="card summary" aria-labelledby="sum-h">
  <h2 id="sum-h">Your request</h2>
  <ul class="sum-list" id="summary">
    ${rows.map(([k, ic, label, empty]) => `<li data-sum="${k}" data-empty="${esc(empty)}"><span class="s-ic">${icon(ic)}</span><span><small>${esc(label)}</small><b>${esc(empty)}</b></span></li>`).join("")}
  </ul>
  <ul class="reassure">
    <li>${icon("clock")}Takes about a minute</li>
    <li>${icon("card")}No payment needed to book</li>
    <li>${icon("message")}We confirm by text &amp; email</li>
  </ul>
  ${page.phone ? `<p class="call">${icon("phone")}<span>Prefer to talk? <a href="${telHref(page.phone)}">${esc(page.phone)}</a></span></p>` : ""}
</aside>`;
}

function successCard(page, booked) {
  return `<section class="card success-card" role="status" tabindex="-1" id="booked">
  <span class="success-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
  <h2>You're all set, ${esc(booked)}!</h2>
  <p>We got your request. ${esc(page.business_name)} will reach out shortly to confirm the details.</p>
  <ol class="timeline">
    <li class="ok"><span class="t-dot">${icon("check")}</span><span><b>Request received</b><span>Just now</span></span></li>
    <li><span class="t-dot">${icon("message")}</span><span><b>We confirm your time</b><span>By text and email</span></span></li>
    <li><span class="t-dot">${icon("sparkles")}</span><span><b>We get it done</b><span>On the day you agreed</span></span></li>
  </ol>
  <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px">
    ${page.phone ? `<a class="btn dark" href="${telHref(page.phone)}">${icon("phone")}Call ${esc(page.phone)}</a>` : ""}
    <a class="btn ghost" href="${esc(page.slug ? `/book/${page.slug}` : "#")}">Book something else</a>
  </div>
</section>`;
}

// Runs before first paint: swaps no-js for js so the stacked fallback never
// flashes. Allowed by its sha256 hash (see book.js).
export function headScriptBody() {
  return `document.documentElement.className="js";`;
}

// The interactive layer. Serialized with Function#toString, so it must not
// use anything from module scope; data comes from data-* attributes.
function bookingClient() {
  var form = document.getElementById("booking-form");
  if (!form) return;
  var steps = [].slice.call(form.querySelectorAll(".step"));
  var stepper = [].slice.call(form.querySelectorAll(".stepper li"));
  var status = document.getElementById("step-status");
  var current = 0;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function nice(d) { return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }

  // ── Steps ──
  function show(i, back) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(function (s, k) {
      s.hidden = k !== current;
      s.classList.remove("enter", "back");
      if (k === current && !reduce) { void s.offsetWidth; s.classList.add("enter"); if (back) s.classList.add("back"); }
    });
    stepper.forEach(function (li, k) {
      li.classList.toggle("done", k < current);
      li.classList.toggle("current", k === current);
    });
    status.textContent = "Step " + (current + 1) + " of " + steps.length + ": " + stepper[current].textContent.replace(/^\d+\.\s*/, "");
  }

  // Move to a step and put focus on its heading, so screen readers hear it.
  function go(i, back) {
    show(i, back);
    scrollToForm();
    var h = steps[current].querySelector("h2");
    if (h) h.focus({ preventScroll: true });
  }

  function scrollToForm() {
    var top = form.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.4) form.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function setError(input, msg) {
    var id = input.id + "_live", old = document.getElementById(id);
    if (old) old.remove();
    if (!msg) { input.removeAttribute("aria-invalid"); return; }
    input.setAttribute("aria-invalid", "true");
    var p = document.createElement("p");
    p.className = "err"; p.id = id; p.textContent = msg;
    input.setAttribute("aria-describedby", id);
    input.closest(".field").appendChild(p);
  }

  var CHECKS = {
    address: function (v) { return v ? "" : "Please enter your street address."; },
    city: function (v) { return v ? "" : "Please enter your city."; },
    zip: function (v) { return !v ? "Please enter your ZIP code." : /^\d{5}(-\d{4})?$/.test(v) ? "" : "Please enter a 5-digit ZIP code."; },
    first_name: function (v) { return v ? "" : "Please enter your first name."; },
    last_name: function (v) { return v ? "" : "Please enter your last name."; },
    phone: function (v) { var d = v.replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return !v ? "Please enter your mobile number." : d.length === 10 ? "" : "Please enter a valid 10-digit US mobile number."; },
    email: function (v) { return !v ? "Please enter your email." : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Please enter a valid email address."; }
  };

  function validate(i) {
    var step = steps[i], firstBad = null;
    if (i === 0) {
      var boxes = step.querySelectorAll('input[name="services"]');
      var live = document.getElementById("f_services_live");
      if (boxes.length && !step.querySelector('input[name="services"]:checked')) {
        if (live) live.hidden = false;
        firstBad = boxes[0];
      } else if (live) live.hidden = true;
    }
    [].forEach.call(step.querySelectorAll("input[name]"), function (input) {
      var check = CHECKS[input.name];
      if (!check) return;
      var msg = check(input.value.trim());
      setError(input, msg);
      if (msg && !firstBad) firstBad = input;
    });
    if (firstBad) { firstBad.focus(); return false; }
    return true;
  }

  form.addEventListener("click", function (e) {
    // A link in the server's error list may point at a field on another step.
    var link = e.target.closest("#form-errors a[href^='#']");
    if (link) {
      var target = document.getElementById(link.getAttribute("href").slice(1));
      var step = target && target.closest(".step");
      if (step) { e.preventDefault(); show(steps.indexOf(step)); scrollToForm(); (target.matches("input,select,textarea") ? target : target.querySelector("input")).focus(); }
      return;
    }
    var t = e.target.closest("[data-next],[data-back]");
    if (!t) return;
    if (t.hasAttribute("data-back")) go(current - 1, true);
    else if (validate(current)) go(current + 1);
  });

  // Enter in a text field moves on instead of submitting early.
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.target.type === "submit" || e.target.type === "button") return;
    if (current < steps.length - 1) { e.preventDefault(); if (validate(current)) go(current + 1); }
  });

  // Re-check a field once it has been flagged, as the person fixes it.
  form.addEventListener("input", function (e) {
    var input = e.target;
    if (input.name === "phone") {
      var d = input.value.replace(/\D/g, "");
      if (d.length === 11 && d[0] === "1") d = d.slice(1);
      if (d.length === 10 && !/[()]/.test(input.value)) input.value = "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    }
    if (input.getAttribute("aria-invalid") === "true" && CHECKS[input.name]) setError(input, CHECKS[input.name](input.value.trim()));
    if (input.name === "services") { var live = document.getElementById("f_services_live"); if (live && form.querySelector('input[name="services"]:checked')) live.hidden = true; }
    summarize(input.name);
  });
  form.addEventListener("change", function (e) { summarize(e.target.name); });

  form.addEventListener("submit", function (e) {
    for (var i = 0; i < steps.length; i++) {
      if (!validate(i)) { e.preventDefault(); show(i); return; }
    }
    var b = document.getElementById("submit-btn");
    setTimeout(function () { b.disabled = true; b.innerHTML = '<span class="spin" aria-hidden="true"></span>Sending…'; }, 0);
  });

  // ── Calendar ──
  var dateInput = document.getElementById("f_preferred_date");
  var today = parse(form.getAttribute("data-today")) || new Date();
  today.setHours(0, 0, 0, 0);
  var last = new Date(today); last.setDate(last.getDate() + 365);
  var view = parse(dateInput.value) || today;
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  var grid = document.getElementById("cal-grid"), monthEl = document.getElementById("cal-month");
  var prev = document.getElementById("cal-prev"), next = document.getElementById("cal-next");

  function drawCalendar() {
    var html = DOW.map(function (d) { return '<span class="cal-dow" aria-hidden="true">' + d + "</span>"; }).join("");
    var first = new Date(view.getFullYear(), view.getMonth(), 1);
    for (var b = 0; b < first.getDay(); b++) html += "<span></span>";
    var days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    var chosen = dateInput.value;
    for (var d = 1; d <= days; d++) {
      var date = new Date(view.getFullYear(), view.getMonth(), d), key = ymd(date);
      var off = date < today || date > last;
      html += '<button type="button" class="day' + (key === ymd(today) ? " today" : "") + '" data-date="' + key + '" aria-label="' + nice(date) + '" aria-pressed="' + (key === chosen) + '"' + (off ? " disabled" : "") + ">" + d + "</button>";
    }
    grid.innerHTML = html;
    monthEl.textContent = MONTHS[view.getMonth()] + " " + view.getFullYear();
    prev.disabled = view <= new Date(today.getFullYear(), today.getMonth(), 1);
    next.disabled = view >= new Date(last.getFullYear(), last.getMonth(), 1);
  }

  function pickLabel() {
    var d = parse(dateInput.value), el = document.getElementById("date-pick");
    el.innerHTML = d ? "<b>" + nice(d) + '</b> · <button type="button" class="link-btn" id="date-clear">Clear</button>' : "No date picked — that's fine, we'll find one together.";
  }

  grid.addEventListener("click", function (e) {
    var b = e.target.closest(".day");
    if (!b || b.disabled) return;
    dateInput.value = dateInput.value === b.getAttribute("data-date") ? "" : b.getAttribute("data-date");
    drawCalendar(); pickLabel(); summarize("preferred_date");
    var again = grid.querySelector('[data-date="' + b.getAttribute("data-date") + '"]');
    if (again) again.focus();
  });
  document.getElementById("date-pick").addEventListener("click", function (e) {
    if (e.target.id !== "date-clear") return;
    dateInput.value = ""; drawCalendar(); pickLabel(); summarize("preferred_date");
  });
  prev.addEventListener("click", function () { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); drawCalendar(); });
  next.addEventListener("click", function () { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); drawCalendar(); });

  // ── Live summary ──
  var sum = document.getElementById("summary");
  function setRow(key, text) {
    var li = sum && sum.querySelector('[data-sum="' + key + '"]');
    if (!li) return;
    var b = li.querySelector("b"), value = text || li.getAttribute("data-empty");
    if (b.textContent === value) return;
    b.textContent = value;
    li.classList.toggle("filled", Boolean(text));
    if (text && !reduce) { li.classList.add("flash"); setTimeout(function () { li.classList.remove("flash"); }, 450); }
  }
  function summarize(changed) {
    var names = [].map.call(form.querySelectorAll('input[name="services"]:checked'), function (i) { return i.getAttribute("data-name"); });
    if (!changed || changed === "services") setRow("services", names.join(", "));
    if (!changed || changed === "preferred_date") { var d = parse(dateInput.value); setRow("date", d ? nice(d) : ""); }
    if (!changed || changed === "preferred_period") {
      var p = form.querySelector('input[name="preferred_period"]:checked');
      setRow("period", p && p.value ? p.parentNode.querySelector("b").textContent : "");
    }
    if (!changed || /^(address|city|zip)$/.test(changed)) {
      var parts = ["address", "city", "zip"].map(function (n) { return form.elements[n].value.trim(); }).filter(Boolean);
      setRow("address", parts.join(", "));
    }
  }

  // ── Start ──
  drawCalendar(); pickLabel(); summarize();
  var bad = form.querySelector('[aria-invalid="true"]');
  var startAt = bad ? steps.indexOf(bad.closest(".step")) : 0;
  show(startAt < 0 ? 0 : startAt);
  var errs = document.getElementById("form-errors");
  if (errs) errs.focus();
  if (location.hash === "#book") scrollToForm();
}

export function formScriptBody() {
  return `(${bookingClient.toString()})();`;
}

/**
 * @param {object} o
 * @param {object} o.page   booking_pages row merged with the company (book.js)
 * @param {string} o.base   absolute URL of the page, e.g. https://host/book/peach-fresh
 * @param {object} o.texts  { sms|email|transactional: { text, version } } rendered
 */
export function renderBookingPage({ page, base, texts, values, errors, utm, formError, booked, today }) {
  const services = activeServices(page);
  const faq = (page.faq || []).filter(f => f && f.question && f.answer);
  const name = page.business_name;
  const serviceLine = services.length
    ? services.length <= 3 ? services.map(s => s.name).join(", ").replace(/, ([^,]*)$/, " and $1") : `${services.slice(0, 2).map(s => s.name).join(", ")} and more`
    : "";

  const ld = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    url: base,
    ...(page.phone ? { telephone: page.phone } : {}),
    ...(page.email ? { email: page.email } : {}),
    ...(page.address_line ? {
      address: { "@type": "PostalAddress", streetAddress: page.address_line, addressLocality: page.address_city, addressRegion: page.address_state, postalCode: page.address_zip, addressCountry: "US" }
    } : {}),
    ...(services.length ? { makesOffer: services.map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name } })) } : {})
  };

  const main = booked
    ? `<div class="booker" style="grid-template-columns:minmax(0,760px);justify-content:center">${successCard(page, booked)}</div>`
    : `<div class="booker" id="book">${bookingForm({ page, base, texts, values, errors, utm, formError, today })}${summaryCard(page)}</div>`;

  const body = `<a class="skip" href="#book">Skip to booking form</a>
${topBar(page, base)}
<main class="wrap">
  ${booked ? "" : `<section class="hero" aria-labelledby="hero-h">
    <span class="eyebrow"><span class="dot">${icon("calendar")}</span>Online booking</span>
    <h1 id="hero-h">Book <em>${esc(name)}</em> in a minute.</h1>
    <p class="lead">${serviceLine ? `${esc(serviceLine)}. ` : ""}Pick what you need and a day that works — we'll confirm by text and email.</p>
    <ul class="chips">
      <li>${icon("clock")}About 1 minute</li>
      <li>${icon("card")}No payment to book</li>
      <li>${icon("shield")}Your info stays private</li>
    </ul>
  </section>`}
  ${main}
  ${booked ? "" : `<section class="section" aria-labelledby="how-h">
    <h2 id="how-h">How it works</h2>
    <ol class="how">
      <li><b>Tell us what you need</b><span>Choose a service, a day and your address.</span></li>
      <li><b>We confirm your time</b><span>We reach out by text and email to lock in the details.</span></li>
      <li><b>We get it done</b><span>Our team shows up at the time we agreed.</span></li>
    </ol>
  </section>`}
  ${faq.length && !booked ? `<section class="section" aria-labelledby="faq-h">
    <h2 id="faq-h">Questions</h2>
    ${faq.map(f => `<details class="faq"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join("")}
  </section>` : ""}
</main>
${footer(page, base)}
${booked ? "" : `<script>${formScriptBody()}</script>`}`;

  return layout({
    page,
    title: `${name} | Book online`,
    description: `Book ${serviceLine ? serviceLine.toLowerCase() : "an appointment"} with ${name} online. Takes about a minute.`,
    canonical: base,
    head: `<script>${headScriptBody()}</script><script type="application/ld+json">${jsonLd(ld)}</script>`,
    body
  });
}

function legalPage({ page, base, title, updated, sections }) {
  const body = `${topBar(page, base)}
<main class="wrap legal">
  <article class="card">
    <h1>${esc(title)}</h1>
    <p class="hint">${esc(page.business_name)}${updated ? ` · Last updated ${esc(updated)}` : ""}</p>
    ${sections.map(([h, html]) => `<h2>${esc(h)}</h2>${html}`).join("\n")}
    <a class="back" href="${esc(base)}">${icon("arrowLeft")}Back to booking</a>
  </article>
</main>
${footer(page, base)}`;
  return layout({ page, title: `${title} | ${page.business_name}`, canonical: `${base}${title === "Privacy Policy" ? "/privacy" : "/sms-terms"}`, body });
}

function contactHtml(page, base) {
  const lines = [
    esc(page.business_name),
    esc(fullAddress(page)),
    page.phone ? `Phone: <a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : "",
    page.email ? `Email: <a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""
  ].filter(Boolean);
  if (lines.length === 1) lines.push(`Use the <a href="${esc(base)}">booking form</a> and mention your request in the notes, or reply to any message we've sent you.`);
  return `<p>${lines.join("<br>")}</p>`;
}

const updatedOn = page => (page.updated_at ? new Date(page.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" }) : "");

export function renderSmsTermsPage({ page, base }) {
  const name = esc(page.business_name);
  const phone = page.phone ? `<a href="${telHref(page.phone)}">${esc(page.phone)}</a>` : "";
  return legalPage({
    page, base, title: "SMS Terms", updated: updatedOn(page),
    sections: [
      ["Program", `<p><b>${name} Text Messages.</b> When you book with us, we send text messages about your appointment: confirmations, reminders, and updates. If you separately opt in on our booking form, we also send marketing and promotional messages such as offers and seasonal reminders.</p>
       <p>Consent to marketing texts is not a condition of purchase.</p>`],
      ["Message frequency", `<p>Message frequency varies.</p>`],
      ["Cost", `<p>Msg &amp; data rates may apply.</p>`],
      ["How to opt out", `<p>Reply <b>STOP</b> to any message to stop receiving texts from us. You can also reply STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT. We'll send one message confirming you've been unsubscribed, and no further marketing messages after that.</p>`],
      ["Help", `<p>Reply <b>HELP</b> to any message for help${phone || page.email ? `, or contact us${phone ? ` at ${phone}` : ""}${page.email ? `${phone ? " or" : " at"} <a href="mailto:${esc(page.email)}">${esc(page.email)}</a>` : ""}` : ""}.</p>`],
      ["Privacy", `<p>Mobile information will not be shared with third parties or affiliates for marketing/promotional purposes. See our <a href="${esc(base)}/privacy">Privacy Policy</a> for details.</p>`],
      ["Carriers", `<p>Carriers are not liable for delayed or undelivered messages.</p>`],
      ["Support", contactHtml(page, base)]
    ]
  });
}

export function renderPrivacyPage({ page, base }) {
  const name = esc(page.business_name);
  return legalPage({
    page, base, title: "Privacy Policy", updated: updatedOn(page),
    sections: [
      ["Who we are", `<p>${name} provides home services. This policy explains what information we collect when you book with us or contact us, and how we use it.</p>`],
      ["Information we collect", `<ul>
        <li>Contact details you give us: name, mobile phone number, email, and service address.</li>
        <li>Details about the service you request: services, preferred date and time, notes, and how you heard about us.</li>
        <li>Your choices about marketing messages, including the exact wording you agreed to and when.</li>
        <li>Technical information sent by your browser when you submit the form: IP address, browser type, and the page and campaign link you came from.</li>
      </ul>`],
      ["How we use it", `<ul>
        <li>To schedule and provide the service you asked for, and to contact you about it (confirmations, reminders, and updates).</li>
        <li>To send marketing texts or emails only if you opted in to them, and to honor your opt-out at any time.</li>
        <li>To keep records of your consent choices, prevent spam and abuse, and meet our legal obligations.</li>
      </ul>`],
      ["Text messages", `<p>Mobile information will not be shared with third parties or affiliates for marketing/promotional purposes. Reply STOP to any text to opt out. See our <a href="${esc(base)}/sms-terms">SMS Terms</a>.</p>`],
      ["Email", `<p>Every marketing email includes an unsubscribe link that works with one click.</p>`],
      ["Sharing", `<p>We do not sell your personal information. We share it only with service providers that help us run our business (for example, hosting, scheduling, and message delivery) under agreements that limit their use of it, or when required by law.</p>`],
      ["Retention", `<p>We keep your information for as long as we need it to serve you and for our records. Records of consent and opt-out requests are kept as long as needed to show we honored your choices.</p>`],
      ["Your choices", `<p>You can ask us to access, correct, or delete your information by contacting us below. You can opt out of marketing at any time without affecting appointment messages about a booking you made.</p>`],
      ["Security", `<p>We use reasonable safeguards to protect your information. No method of transmission over the internet is completely secure.</p>`],
      ["Children", `<p>Our services and this website are not directed to children under 13, and we do not knowingly collect their information.</p>`],
      ["Changes", `<p>If we change this policy we'll post the new version here with a new "last updated" date.</p>`],
      ["Contact us", contactHtml(page, base)]
    ]
  });
}

export function renderMessagePage({ title, message, page, form }) {
  const body = `<main class="wrap legal" style="padding-top:48px">
  <article class="card">
    ${page?.business_name ? `<p class="hint">${esc(page.business_name)}</p>` : ""}
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    ${form || ""}
  </article>
</main>`;
  return layout({ page, title, body });
}
