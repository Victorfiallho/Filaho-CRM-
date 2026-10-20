// Groups, short descriptions and job questions for the booking page.
// Services are whatever each company typed in the CRM, so everything here is
// matched on the name. Pure: shared by the renderer and the form parser.
//
// Grouping: "Carpet Cleaning (Shampoo Cleaning)" goes under "Carpet Cleaning"
// as "Shampoo Cleaning". Recurring, deep and one-time cleans go under
// "House Cleaning" even without the parentheses. Anything else is a group of
// its own and shows as a single tile.

// Zero-width and other invisible characters pasted into CRM service names.
const INVISIBLE = /[​-‍⁠﻿]/g;
export const cleanName = name => String(name || "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const slug = s => cleanName(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";

const GROUP_RULES = [
  [/recurr|recur|weekly|bi-?weekly|monthly|deep clean|one-?time|move.?(in|out)|maid|house ?clean|home ?clean/i, "House Cleaning"]
];

export function groupOf(name) {
  const n = cleanName(name);
  const paren = /^(.+?)\s*\((.+)\)\s*$/.exec(n);
  if (paren) return { group: paren[1].trim(), option: paren[2].trim() };
  const rule = GROUP_RULES.find(([re]) => re.test(n));
  if (rule) return { group: rule[1], option: n };
  return { group: n, option: n };
}

// [{ key, name, services: [{...service, option}] }] in the services' order.
// A group with one service keeps the service's full name.
export function groupServices(services) {
  const groups = new Map();
  for (const s of services) {
    const { group, option } = groupOf(s.name);
    const key = slug(group);
    if (!groups.has(key)) groups.set(key, { key, name: group, services: [] });
    groups.get(key).services.push({ ...s, option });
  }
  return [...groups.values()].map(g => (g.services.length === 1 ? { ...g, name: cleanName(g.services[0].name) } : g));
}

const DESCRIPTION_RULES = [
  [/shampoo|extraction|steam/i, "Hot water extraction for a deep clean"],
  [/refresh|maintenance|light/i, "A lighter clean to freshen things up"],
  [/recurr|recur|weekly|monthly/i, "Weekly, every 2 weeks or monthly"],
  [/deep/i, "Top to bottom, including the hard-to-reach spots"],
  [/one-?time/i, "A full clean, once"],
  [/move.?(in|out)/i, "Empty home, ready for the next move"],
  [/upholst|uphost|sofa|couch/i, "Sofas, chairs and mattresses"],
  [/refac/i, "New doors and fronts on your existing cabinets"],
  [/refinish/i, "Sand and refinish the floors you have"],
  [/custom/i, "Built to measure for your space"]
];
export const describeService = name => (DESCRIPTION_RULES.find(([re]) => re.test(cleanName(name))) || [null, ""])[1];

// ── Questions ───────────────────────────────────────────────────────────
// type count: a number with − and + buttons. choice: one pill. multi: any.
// `w` is how much an answer adds to the job size estimate (0 to 2).
// Questions are shared: if two chosen services ask "Bedrooms" it shows once.
const CHOICE_SIZE = [["Small", 0], ["Medium", 1], ["Large", 2], ["Not sure", 0]];
const TIMELINE = { key: "timeline", topic: "project", type: "choice", label: "When would you like to start?", options: [["As soon as possible", 0], ["In 1 to 3 months", 0], ["In 3+ months", 0], ["Just getting prices", 0]] };

export const QUESTIONS = [
  { key: "carpet_rooms", topic: "carpet", type: "count", label: "Rooms or areas with carpet", max: 30, w: n => (n >= 8 ? 2 : n >= 4 ? 1 : 0) },
  { key: "carpet_stairs", topic: "carpet", type: "count", label: "Staircases", max: 10, w: n => (n >= 2 ? 2 : n ? 1 : 0) },
  { key: "carpet_rugs", topic: "carpet", type: "count", label: "Area rugs", max: 20, w: n => (n >= 3 ? 1 : 0) },
  { key: "carpet_condition", topic: "carpet", type: "choice", label: "How do the carpets look?", options: [["Light: regular upkeep", 0], ["Moderate: traffic paths, a few spots", 1], ["Heavy: lots of stains or odors", 2]] },
  { key: "carpet_issues", topic: "carpet", type: "multi", label: "Anything we should plan for?", options: [["Pet stains or odors", 1], ["Tough stains (wine, coffee, ink)", 1], ["Furniture to move", 1]] },

  { key: "uph_sofas", topic: "upholstery", type: "count", label: "Sofas or loveseats", max: 10, w: n => (n >= 3 ? 2 : n ? 1 : 0) },
  { key: "uph_sectional", topic: "upholstery", type: "count", label: "Sectional pieces", max: 10, w: n => (n >= 4 ? 2 : n ? 1 : 0) },
  { key: "uph_chairs", topic: "upholstery", type: "count", label: "Armchairs or recliners", max: 20, w: n => (n >= 4 ? 1 : 0) },
  { key: "uph_dining", topic: "upholstery", type: "count", label: "Dining chairs", max: 30, w: n => (n >= 8 ? 1 : 0) },
  { key: "uph_mattress", topic: "upholstery", type: "count", label: "Mattresses", max: 10, w: n => (n >= 3 ? 1 : 0) },
  { key: "uph_issues", topic: "upholstery", type: "multi", label: "Anything we should plan for?", options: [["Pet hair or odors", 1], ["Stains", 1], ["Leather or delicate fabric", 1]] },

  { key: "frequency", topic: "home", type: "choice", label: "How often?", options: [["Weekly", 0], ["Every 2 weeks", 0], ["Monthly", 0], ["Not sure yet", 0]] },
  { key: "bedrooms", topic: "home", type: "choice", label: "Bedrooms", options: [["1", 0], ["2", 0], ["3", 1], ["4", 1], ["5+", 2]] },
  { key: "bathrooms", topic: "home", type: "choice", label: "Bathrooms", options: [["1", 0], ["2", 0], ["3", 1], ["4+", 2]] },
  { key: "home_size", topic: "home", type: "choice", label: "Home size", options: [["Under 1,000 sq ft", 0], ["1,000 to 2,000 sq ft", 0], ["2,000 to 3,000 sq ft", 1], ["Over 3,000 sq ft", 2], ["Not sure", 0]] },
  { key: "last_cleaned", topic: "home", type: "choice", label: "Last professional cleaning", options: [["Within a month", 0], ["1 to 6 months ago", 1], ["Over 6 months ago", 2], ["Never or not sure", 2]] },
  { key: "pets", topic: "home", type: "choice", label: "Pets at home", options: [["None", 0], ["1", 0], ["2 or more", 1]] },
  { key: "extras", topic: "home", type: "multi", label: "Extras", options: [["Inside the oven", 1], ["Inside the fridge", 1], ["Inside cabinets", 1], ["Interior windows", 1], ["Baseboards", 0], ["Laundry", 0]] },

  { key: "kitchen_size", topic: "project", type: "choice", label: "Size of the kitchen", options: CHOICE_SIZE },
  { key: "kitchen_scope", topic: "project", type: "choice", label: "What's the plan?", options: [["New cabinets only", 0], ["Cabinets and countertops", 1], ["Full remodel", 2], ["Not sure yet", 0]] },
  { key: "bath_count", topic: "project", type: "count", label: "Bathrooms to work on", max: 10, w: n => (n >= 3 ? 2 : n >= 2 ? 1 : 0) },
  { key: "bath_scope", topic: "project", type: "choice", label: "What's the plan?", options: [["Vanity only", 0], ["Vanity and countertop", 1], ["Full remodel", 2], ["Not sure yet", 0]] },
  { key: "doors", topic: "project", type: "choice", label: "About how many cabinet doors?", options: [["Under 15", 0], ["15 to 30", 1], ["Over 30", 2], ["Not sure", 0]] },
  { key: "custom_what", topic: "project", type: "multi", label: "What would you like built?", options: [["Kitchen", 2], ["Bathroom vanity", 1], ["Closet or pantry", 1], ["Built-ins or shelving", 1], ["Laundry or garage", 1]] },
  { key: "floor_area", topic: "project", type: "choice", label: "About how much floor?", options: [["Under 300 sq ft (one room)", 0], ["300 to 800 sq ft", 1], ["800 to 1,500 sq ft", 2], ["Over 1,500 sq ft", 2], ["Not sure", 0]] },
  { key: "floor_now", topic: "project", type: "choice", label: "What's on the floor now?", options: [["Carpet", 0], ["Hardwood", 0], ["Tile", 1], ["Vinyl or laminate", 0], ["Bare concrete or subfloor", 0], ["Not sure", 0]] },
  { key: "floor_condition", topic: "project", type: "choice", label: "Condition of the floors", options: [["Light scratches", 0], ["Worn finish", 1], ["Damaged or loose boards", 2]] },
  { key: "floor_stairs", topic: "project", type: "count", label: "Stair steps", max: 40, w: n => (n >= 12 ? 2 : n ? 1 : 0) },
  { key: "plans", topic: "project", type: "choice", label: "Do you have measurements or a design?", options: [["Yes", 0], ["Some ideas", 0], ["Not yet, I need help", 1]] },
  TIMELINE
];
const BY_KEY = new Map(QUESTIONS.map(q => [q.key, q]));

export const TOPICS = { carpet: "Your carpets", upholstery: "Your furniture", home: "Your home", project: "Your project" };

// Which questions a service asks, by name. First match wins; cleaning rules
// come first so a cleaning company's "Carpet" isn't read as flooring.
const SETS = [
  [/upholst|uphost|sofa|couch|mattress/i, ["uph_sofas", "uph_sectional", "uph_chairs", "uph_dining", "uph_mattress", "uph_issues"]],
  [/(carpet|rug).*(clean|shampoo|refresh)|(clean|shampoo|refresh).*(carpet|rug)/i, ["carpet_rooms", "carpet_stairs", "carpet_rugs", "carpet_condition", "carpet_issues"]],
  [/recurr|recur|weekly|monthly/i, ["frequency", "bedrooms", "bathrooms", "home_size", "pets"]],
  [/clean|maid/i, ["bedrooms", "bathrooms", "home_size", "last_cleaned", "pets", "extras"]],
  [/refinish/i, ["floor_area", "floor_condition", "floor_stairs", "timeline"]],
  [/floor|carpet|tile|lvp|hardwood|laminate|vinyl/i, ["floor_area", "floor_now", "floor_stairs", "timeline"]],
  [/refac/i, ["doors", "kitchen_size", "timeline"]],
  [/bath|vanit/i, ["bath_count", "bath_scope", "plans", "timeline"]],
  [/custom/i, ["custom_what", "plans", "timeline"]],
  [/kitchen|cabinet/i, ["kitchen_size", "kitchen_scope", "plans", "timeline"]]
];
export const questionKeysFor = name => (SETS.find(([re]) => re.test(cleanName(name))) || [null, ["timeline"]])[1];

// The questions the chosen services ask, each once, in QUESTIONS order.
export function questionsFor(services) {
  const keys = new Set(services.flatMap(s => questionKeysFor(s.name)));
  return QUESTIONS.filter(q => keys.has(q.key));
}

export const fieldName = q => `q_${q.key}`;
const MAX_COUNT = 99;

// Reads the answers for the chosen services. Everything is optional; values
// that aren't one of the options are dropped. Returns
// { values: {key: string|string[]}, errors: {fieldName: msg}, answers: [{label, value}] }.
export function parseAnswers(form, chosenServices) {
  const values = {}, errors = {}, answers = [];
  let score = 0, answered = 0;
  for (const q of questionsFor(chosenServices)) {
    const name = fieldName(q);
    if (q.type === "multi") {
      const allowed = new Map(q.options);
      const picked = form.getAll(name).map(String).filter(v => allowed.has(v));
      if (!picked.length) continue;
      values[q.key] = picked;
      answers.push({ label: q.label, value: picked.join(", ") });
      score += picked.reduce((t, v) => t + allowed.get(v), 0);
      answered++;
      continue;
    }
    const raw = String(form.get(name) ?? "").trim().slice(0, 80);
    if (!raw) continue;
    values[q.key] = raw;
    if (q.type === "count") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > (q.max || MAX_COUNT)) { errors[name] = `Enter a number from 0 to ${q.max || MAX_COUNT}.`; continue; }
      answers.push({ label: q.label, value: String(n) });
      score += q.w ? q.w(n) : 0;
      answered++;
    } else {
      const opt = q.options.find(([label]) => label === raw);
      if (!opt) { delete values[q.key]; continue; }
      answers.push({ label: q.label, value: raw });
      score += opt[1];
      answered++;
    }
  }
  if (answered) answers.push({ label: "Estimated job size", value: jobSize(score, chosenServices.length) });
  return { values, errors, answers };
}

// A rough guide for the team before the visit, not a price.
export function jobSize(score, serviceCount = 1) {
  const s = score + Math.max(0, serviceCount - 1);
  return s >= 6 ? "Large" : s >= 3 ? "Medium" : "Small";
}

export const questionByKey = key => BY_KEY.get(key);
