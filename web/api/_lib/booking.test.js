import { describe, expect, it } from "vitest";
import { parseBookingForm, serviceId, servicesFromCrm } from "./bookingForm.js";
import { esc, formScriptBody, headScriptBody, linkifyConsent, renderBookingPage, renderPrivacyPage, renderSmsTermsPage, serviceIcon, textOn } from "./bookingHtml.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribeToken.js";

const NOW = new Date("2026-10-13T16:00:00Z"); // noon in Atlanta

const page = {
  company_id: "peach_fresh",
  slug: "peach-fresh",
  active: true,
  business_name: "Peach Fresh",
  hero_title: "Carpet cleaning",
  hero_subtitle: "",
  primary_color: "#f36f45",
  logo_url: "",
  phone: "(404) 555-0100",
  email: "hello@example.com",
  address_line: "1 Main St",
  address_city: "Marietta",
  address_state: "GA",
  address_zip: "30060",
  service_cities: ["Marietta", "Roswell"],
  zip_prefixes: ["300", "3007"],
  services: [
    { id: "carpet", name: "Carpet cleaning", position: 0, active: true },
    { id: "rug", name: "Rug cleaning", position: 1, active: true },
    { id: "old", name: "Retired service", position: 2, active: false }
  ],
  faq: [{ question: "Do you move furniture?", answer: "Light pieces, yes." }],
  reviews: [],
  seo_title: "Peach Fresh",
  seo_description: "Book online",
  updated_at: "2026-10-13T12:00:00Z"
};

const texts = {
  sms: { version: 1, text: "Yes, I agree to receive marketing texts from Peach Fresh. See our SMS Terms and Privacy Policy." },
  email: { version: 1, text: "Yes, send me offers by email." },
  transactional: { version: 1, text: "By booking, you agree to receive texts and emails about this appointment." }
};

function form(fields) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) p.append(k, item);
  return p;
}

const valid = {
  first_name: "Jane", last_name: "Doe", phone: "(404) 555-0123", email: "Jane@Example.com",
  address: "10 Oak St", city: "Marietta", zip: "30062", services: ["rug"]
};

describe("parseBookingForm", () => {
  it("accepts the required fields alone, with both consents false by default", () => {
    const r = parseBookingForm(form(valid), page, NOW);
    expect(r.ok).toBe(true);
    expect(r.booking).toMatchObject({
      name: "Jane Doe", phone_e164: "+14045550123", email: "jane@example.com", state: "GA", zip: "30062",
      sms_consent: false, email_consent: false, services: ["Rug cleaning"]
    });
  });

  it("reads the two consent boxes independently", () => {
    expect(parseBookingForm(form({ ...valid, sms_consent: "yes" }), page, NOW).booking).toMatchObject({ sms_consent: true, email_consent: false });
    expect(parseBookingForm(form({ ...valid, email_consent: "yes" }), page, NOW).booking).toMatchObject({ sms_consent: false, email_consent: true });
  });

  it("reports every missing required field", () => {
    const r = parseBookingForm(form({}), page, NOW);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["email", "first_name", "last_name", "phone", "services"]);
  });

  it("accepts a booking without an address", () => {
    const r = parseBookingForm(form({ ...valid, address: "", city: "", zip: "" }), page, NOW);
    expect(r.ok).toBe(true);
    expect(r.booking).toMatchObject({ address: "", city: "", state: "", zip: "" });
  });

  it("accepts any valid US ZIP (no service-area filter) and rejects malformed ones", () => {
    expect(parseBookingForm(form({ ...valid, zip: "90210" }), page, NOW).ok).toBe(true);
    const r = parseBookingForm(form({ ...valid, zip: "9021" }), page, NOW);
    expect(r.errors.zip).toBe("Please enter a 5-digit ZIP code.");
    expect(r.values.first_name).toBe("Jane"); // typed values survive
  });

  it("requires a service when the company has any", () => {
    expect(parseBookingForm(form({ ...valid, services: [] }), page, NOW).errors.services).toMatch(/at least one/);
    expect(parseBookingForm(form({ ...valid, services: [] }), { ...page, services: [] }, NOW).ok).toBe(true);
  });

  it("rejects past dates and accepts today", () => {
    expect(parseBookingForm(form({ ...valid, preferred_date: "2026-10-12" }), page, NOW).errors.preferred_date).toMatch(/today or a later/);
    expect(parseBookingForm(form({ ...valid, preferred_date: "2026-10-13" }), page, NOW).ok).toBe(true);
  });

  it("keeps only active services and stores the job answers in the order asked", () => {
    const r = parseBookingForm(form({ ...valid, services: ["carpet", "old", "bogus"], q_carpet_rooms: "5", q_carpet_condition: "Heavy: lots of stains or odors", q_carpet_issues: ["Pet stains or odors", "bogus"], q_bedrooms: "3" }), page, NOW);
    expect(r.booking.services).toEqual(["Carpet cleaning"]);
    expect(r.booking.details).toEqual([
      { label: "Rooms or areas with carpet", value: "5" },
      { label: "How do the carpets look?", value: "Heavy: lots of stains or odors" },
      { label: "Anything we should plan for?", value: "Pet stains or odors" },
      { label: "Estimated job size", value: "Medium" }
    ]);
  });

  it("rejects a count out of range and needs no answers at all", () => {
    expect(parseBookingForm(form({ ...valid, services: ["carpet"], q_carpet_rooms: "-1" }), page, NOW).errors.q_carpet_rooms).toBeTruthy();
    expect(parseBookingForm(form({ ...valid, services: ["carpet"] }), page, NOW).booking.details).toEqual([]);
  });

  it("drops an unknown period or heard-from value instead of storing it", () => {
    const r = parseBookingForm(form({ ...valid, preferred_period: "midnight", heard_from: "<script>" }), page, NOW);
    expect(r.booking.preferred_period).toBeNull();
    expect(r.booking.heard_from).toBe("");
  });

});

describe("CRM services", () => {
  it("become the page's services, with stable ids and no duplicates", () => {
    expect(servicesFromCrm([{ service: "Move-in/Move-out", position: 2 }, { service: " Deep Cleaning ", position: 0 }, { service: "" }, { service: "deep cleaning", position: 3 }]))
      .toEqual([
        { id: "move-in-move-out", name: "Move-in/Move-out", position: 2, active: true },
        { id: "deep-cleaning", name: "Deep Cleaning", position: 0, active: true }
      ]);
    expect(serviceId("Kitchen Cabinets")).toBe("kitchen-cabinets");
  });

  it("get an icon from their name, with a default", () => {
    expect(serviceIcon("Kitchen Cabinets")).toBe("cabinet");
    expect(serviceIcon("Bathroom Vanities")).toBe("drop");
    expect(serviceIcon("Recurring Cleaning")).toBe("repeat");
    expect(serviceIcon("Something new")).toBe("sparkles");
  });
});

describe("renderBookingPage", () => {
  const html = renderBookingPage({ page, base: "https://crm.test/book/peach-fresh", texts, today: "2026-10-13" });

  it("renders two separate, unchecked, optional consent checkboxes", () => {
    const sms = html.match(/<input type="checkbox" id="sms_consent"[^>]*>/)[0];
    const email = html.match(/<input type="checkbox" id="email_consent"[^>]*>/)[0];
    for (const box of [sms, email]) {
      expect(box).not.toMatch(/checked/);
      expect(box).not.toMatch(/required/);
    }
  });

  it("shows the exact consent and transactional texts, with the versions in hidden fields", () => {
    expect(html).toContain("Yes, send me offers by email.");
    expect(html).toContain(texts.transactional.text);
    expect(html).toContain('name="sms_text_version" value="1"');
    expect(html).toContain('href="https://crm.test/book/peach-fresh/sms-terms"');
  });

  it("has a honeypot, a LocalBusiness JSON-LD block and the footer links", () => {
    expect(html).toMatch(/name="website"[^>]*tabindex="-1"/);
    expect(html).toContain('"@type":"LocalBusiness"');
    expect(html).toContain("/book/peach-fresh/privacy");
    expect(html).toContain("1 Main St, Marietta, GA 30060");
  });

  it("is one form with the five steps, so it still works without JavaScript", () => {
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('action="https://crm.test/book/peach-fresh"');
    expect(html.match(/<fieldset class="step"/g)).toHaveLength(5);
    expect(html).toContain('<html lang="en" class="no-js">');
    expect(html).toMatch(/name="preferred_date" type="date"/);
  });

  it("shows a tile per active service and builds the headline from the company", () => {
    expect(html.match(/<label class="tile"/g)).toHaveLength(2);
    expect(html).not.toContain("Retired service");
    expect(html).toContain("Schedule a free visit with <em>Peach Fresh</em>.");
    // The business process: visit first, then the quote, then the date for the work.
    expect(html).toContain("We visit and send your quote");
    expect(html).toContain("Schedule my free visit");
    expect(html).toContain("Carpet cleaning and Rug cleaning.");
  });

  it("inlines exactly the two scripts the CSP hashes", () => {
    expect(html).toContain(`<script>${headScriptBody()}</script>`);
    expect(html).toContain(`<script>${formScriptBody()}</script>`);
    expect(formScriptBody()).not.toMatch(/supabase|service_role/i);
    // the HTML parser drops CRs before hashing, so a CR here breaks the CSP hash
    expect(formScriptBody()).not.toContain("\r");
  });

  it("leaves out contact details the company hasn't given yet", () => {
    const bare = renderBookingPage({ page: { ...page, phone: "", email: "", address_line: "", address_city: "", address_state: "", address_zip: "" }, base: "https://x/book/p", texts, today: "2026-10-13" });
    expect(bare).not.toContain("tel:");
    expect(bare).not.toContain("<address");
    expect(bare).toContain("Schedule a visit");
  });

  it("escapes admin-entered content", () => {
    const evil = renderBookingPage({ page: { ...page, services: [{ id: "x", name: '<img src=x onerror="alert(1)">', active: true }], business_name: "A</script><script>x()</script>" }, base: "https://x/book/p", texts, today: "2026-10-13" });
    expect(evil).not.toContain("<img src=x");
    expect(evil).not.toContain("</script><script>x()");
  });

  it("re-renders errors with the typed values and the phone as an alternative", () => {
    const again = renderBookingPage({ page, base: "https://x/book/p", texts, today: "2026-10-13", values: { first_name: "Jane", sms_consent: true }, errors: { zip: "Please enter a 5-digit ZIP code." } });
    expect(again).toContain('value="Jane"');
    expect(again).toContain("Please enter a 5-digit ZIP code.");
    expect(again).toMatch(/id="f_zip"[^>]*aria-invalid="true"/);
    expect(again).toMatch(/id="sms_consent"[^>]*checked/);
    expect(again).toContain('href="tel:4045550100"');
  });

  it("shows the confirmation with the first name instead of the form", () => {
    const done = renderBookingPage({ page, base: "https://x/book/p", texts, today: "2026-10-13", booked: "Jane" });
    expect(done).toContain("You're all set, Jane!");
    expect(done).not.toContain("<form");
  });
});

describe("legal pages", () => {
  it("SMS terms carry everything carriers check for", () => {
    const html = renderSmsTermsPage({ page, base: "https://x/book/p" });
    for (const s of ["Peach Fresh Text Messages", "Message frequency varies.", "Msg &amp; data rates may apply.", "STOP", "HELP",
      "Mobile information will not be shared with third parties or affiliates for marketing/promotional purposes.", "(404) 555-0100"]) {
      expect(html).toContain(s);
    }
  });

  it("privacy policy names the business and its address", () => {
    const html = renderPrivacyPage({ page, base: "https://x/book/p" });
    expect(html).toContain("Peach Fresh");
    expect(html).toContain("1 Main St, Marietta, GA 30060");
  });
});

describe("html helpers", () => {
  it("escapes", () => expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;"));
  it("picks readable text on the brand color", () => {
    expect(textOn("#111827")).toBe("#ffffff");
    expect(textOn("#fde68a")).toBe("#111827");
  });
  it("links SMS Terms / Privacy Policy without changing the words", () => {
    expect(linkifyConsent("See our SMS Terms and Privacy Policy.", "/b").replace(/<[^>]+>/g, "")).toBe("See our SMS Terms and Privacy Policy.");
  });
});

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = createUnsubscribeToken({ email: "Jane@Example.com", companyId: "peach_fresh" }, "s3cret");
    expect(verifyUnsubscribeToken(t, "s3cret")).toEqual({ email: "jane@example.com", companyId: "peach_fresh" });
    expect(verifyUnsubscribeToken(t, "other")).toBeNull();
    const forged = createUnsubscribeToken({ email: "victim@example.com", companyId: "peach_fresh" }, "s3cret").split(".")[0] + "." + t.split(".")[1];
    expect(verifyUnsubscribeToken(forged, "s3cret")).toBeNull();
    expect(verifyUnsubscribeToken("garbage", "s3cret")).toBeNull();
  });
});
