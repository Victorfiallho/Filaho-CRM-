import { describe, expect, it } from "vitest";
import { cleanName, groupServices, jobSize, parseAnswers, questionKeysFor, questionsFor } from "./serviceQuestions.js";
import { renderBookingPage } from "./bookingHtml.js";

// Peach Fresh's CRM services as typed, typos included.
const PEACH = ["Carpet Cleaning (Shampoo Cleaning)", "Carpet Cleaning (Refresh Cleaning)", "House Cleaning(One-Time Cleaning)", "Recuring Cleaning", "Deep Cleaning", "Uphostery Cleaning"]
  .map((name, i) => ({ id: `s${i}`, name, position: i, active: true }));

const form = fields => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) p.append(k, item);
  return p;
};

describe("service groups", () => {
  it("groups by the name in parentheses and puts every house clean together", () => {
    expect(groupServices(PEACH).map(g => [g.name, g.services.map(s => s.option)])).toEqual([
      ["Carpet Cleaning", ["Shampoo Cleaning", "Refresh Cleaning"]],
      ["House Cleaning", ["One-Time Cleaning", "Recuring Cleaning", "Deep Cleaning"]],
      ["Uphostery Cleaning", ["Uphostery Cleaning"]]
    ]);
  });

  it("leaves other companies' services as single tiles", () => {
    const flooring = ["Floor Installation", "Floor Refinishing", "Carpet", "Tile"].map((name, i) => ({ id: `f${i}`, name }));
    expect(groupServices(flooring).every(g => g.services.length === 1)).toBe(true);
  });

  it("drops invisible characters pasted into a name", () => {
    expect(cleanName("⁠Bathroom Remodeling")).toBe("Bathroom Remodeling");
  });
});

describe("job questions", () => {
  it("asks each service the questions that fit it", () => {
    expect(questionKeysFor("Carpet Cleaning (Shampoo Cleaning)")).toContain("carpet_rooms");
    expect(questionKeysFor("Uphostery Cleaning")).toContain("uph_sofas");
    expect(questionKeysFor("Recuring Cleaning")).toContain("frequency");
    expect(questionKeysFor("Deep Cleaning")).toContain("extras");
    expect(questionKeysFor("Carpet")).toContain("floor_area");
    expect(questionKeysFor("Floor Refinishing")).toContain("floor_condition");
    expect(questionKeysFor("Kitchen Cabinets")).toContain("kitchen_scope");
    expect(questionKeysFor("⁠Bathroom Remodeling")).toContain("bath_scope");
    expect(questionKeysFor("Something new")).toEqual(["timeline"]);
  });

  it("asks a shared question once", () => {
    const keys = questionsFor([PEACH[3], PEACH[4]]).map(q => q.key);
    expect(keys.filter(k => k === "bedrooms")).toHaveLength(1);
  });

  it("ignores answers for services that weren't picked and values that aren't options", () => {
    const r = parseAnswers(form({ q_bedrooms: "9", q_carpet_rooms: "4", q_pets: "None" }), [PEACH[4]]);
    expect(r.answers).toEqual([{ label: "Pets at home", value: "None" }, { label: "Estimated job size", value: "Small" }]);
  });

  it("sizes the job from the answers and the number of services", () => {
    expect(jobSize(0)).toBe("Small");
    expect(jobSize(3)).toBe("Medium");
    expect(jobSize(4, 3)).toBe("Large");
  });
});

describe("booking page", () => {
  const page = { company_id: "peach_fresh", slug: "peach-fresh", business_name: "Peach Fresh", primary_color: "#f36f45", services: PEACH, faq: [] };
  const texts = { sms: { version: 1, text: "SMS Terms Privacy Policy" }, email: { version: 1, text: "e" }, transactional: { version: 1, text: "t" } };
  const html = renderBookingPage({ page, base: "https://crm.test/book/peach-fresh", texts, today: "2026-10-20" });

  it("shows a tile per group and each group's options in its own panel", () => {
    expect(html.match(/class="tile g-tile"/g)).toHaveLength(2);
    expect(html.match(/<label class="tile"/g)).toHaveLength(1);
    expect(html).toContain('id="grp_carpet-cleaning"');
    expect(html).toContain("Which house cleaning?");
    expect(html.match(/<input type="checkbox" name="services"/g)).toHaveLength(6);
    expect(html).toContain("Carpet Cleaning, House Cleaning and Uphostery Cleaning.");
  });

  it("opens a group whose option comes back checked after an error", () => {
    const again = renderBookingPage({ page, base: "https://x/book/p", texts, today: "2026-10-20", values: { services: ["s1"] }, errors: { phone: "x" } });
    expect(again).toMatch(/data-group="carpet-cleaning" aria-controls="grp_carpet-cleaning" aria-expanded="true" checked/);
    expect(again).toMatch(/<fieldset class="variants" id="grp_carpet-cleaning" data-group="carpet-cleaning">/);
  });

  it("tags every question with the services that ask it", () => {
    expect(html).toMatch(/class="q q-count" data-svc="s0 s1"/);
    expect(html).toMatch(/data-svc="s2 s3 s4" id="f_q_bedrooms"/);
  });
});
