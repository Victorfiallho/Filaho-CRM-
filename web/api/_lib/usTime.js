// US ZIP > state > time zone, for the SMS quiet-hours check in consent.js.
// (Vercel doesn't turn underscore-prefixed folders like api/_lib into routes.)
//
// ZIP3 ranges are the USPS prefix allocations. A state that spans two zones
// (FL panhandle, west TN, west TX...) maps to every zone it touches, and the
// SMS window must hold in all of them: 8:30am Eastern is 7:30am in Pensacola.

const ZIP3_RANGES = [
  [5, 5, "NY"], [6, 9, "PR"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"],
  [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"],
  [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"],
  [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"],
  [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"],
  [550, 567, "MN"], [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"],
  [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"],
  [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"],
  [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"],
  [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"],
  [995, 999, "AK"]
];

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const PT = "America/Los_Angeles";

export const STATE_TIME_ZONES = {
  CT: [ET], DE: [ET], DC: [ET], GA: [ET], ME: [ET], MD: [ET], MA: [ET], NH: [ET], NJ: [ET],
  NY: [ET], NC: [ET], OH: [ET], PA: [ET], RI: [ET], SC: [ET], VT: [ET], VA: [ET], WV: [ET],
  FL: [ET, CT], IN: ["America/Indiana/Indianapolis", CT], KY: [ET, CT], MI: ["America/Detroit", CT],
  TN: [CT, ET],
  AL: [CT], AR: [CT], IL: [CT], IA: [CT], LA: [CT], MN: [CT], MS: [CT], MO: [CT], OK: [CT], WI: [CT],
  KS: [CT, MT], NE: [CT, MT], ND: [CT, MT], SD: [CT, MT], TX: [CT, MT],
  AZ: ["America/Phoenix"], CO: [MT], MT: [MT], NM: [MT], UT: [MT], WY: [MT],
  ID: ["America/Boise", PT], OR: [PT, "America/Boise"],
  CA: [PT], NV: [PT], WA: [PT],
  AK: ["America/Anchorage"], HI: ["Pacific/Honolulu"], PR: ["America/Puerto_Rico"]
};

export const DEFAULT_TIME_ZONE = ET;

export function zipToState(zip) {
  const digits = String(zip || "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  const prefix = Number(digits.slice(0, 3));
  const hit = ZIP3_RANGES.find(([from, to]) => prefix >= from && prefix <= to);
  return hit ? hit[2] : null;
}

// State first (it's what the person typed or what the record says), ZIP as
// the fallback, Eastern when neither resolves.
export function timeZonesFor({ state, zip } = {}) {
  const st = String(state || "").trim().toUpperCase();
  if (STATE_TIME_ZONES[st]) return STATE_TIME_ZONES[st];
  const fromZip = zipToState(zip);
  if (fromZip && STATE_TIME_ZONES[fromZip]) return STATE_TIME_ZONES[fromZip];
  return [DEFAULT_TIME_ZONE];
}

// Decimal hour (e.g. 20.5 = 8:30pm) at `date` in `timeZone`.
export function localHour(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  const minute = Number(parts.find(p => p.type === "minute")?.value);
  return hour + minute / 60;
}

// [start, end) in local hours: 8 to 21 means 8:00am up to, not including, 9:00pm.
export const SMS_WINDOW = { start: 8, end: 21 };

export function isWithinSmsWindow(contact, now = new Date(), window = SMS_WINDOW) {
  return timeZonesFor(contact).every(tz => {
    const h = localHour(now, tz);
    return h >= window.start && h < window.end;
  });
}

// YYYY-MM-DD "today" in a zone (the booking form's min date).
export function todayIn(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
