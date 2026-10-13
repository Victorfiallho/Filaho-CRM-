import { describe, expect, it } from "vitest";
import { parseBookingForm, zipAccepted } from "./bookingForm.js";
import { esc, linkifyConsent, renderBookingPage, renderPrivacyPage, renderSmsTermsPage, textOn } from "./bookingHtml.js";
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
    { id: "carpet", name: "Carpet cleaning", detail_label: "Number of rooms", position: 0, active: true },
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
  address: "10 Oak St", city: "Marietta", zip: "30062"
};

describe("parseBookingForm", () => {
  it("accepts the required fields alone, with both consents false by default", () => {
    const r = parseBookingForm(form(valid), page, NOW);
    expect(r.ok).toBe(true);
    expect(r.booking).toMatchObject({
      name: "Jane Doe", phone_e164: "+14045550123", email: "jane@example.com", state: "GA", zip: "30062",
      sms_consent: false, email_consent: false, services: []
    });
  });

  it("reads the two consent boxes independently", () => {
    expect(parseBookingForm(form({ ...valid, sms_consent: "yes" }), page, NOW).booking).toMatchObject({ sms_consent: true, email_consent: false });
    expect(parseBookingForm(form({ ...valid, email_consent: "yes" }), page, NOW).booking).toMatchObject({ sms_consent: false, email_consent: true });
  });

  it("reports every missing required field", () => {
    const r = parseBookingForm(form({}), page, NOW);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["address", "city", "email", "first_name", "last_name", "phone", "zip"]);
  });

  it("refuses ZIPs outside the accepted prefixes with the exact message", () => {
    const r = parseBookingForm(form({ ...valid, zip: "90210" }), page, NOW);
    expect(r.errors.zip).toBe("We don't serve this area yet");
    expect(r.values.first_name).toBe("Jane"); // typed values survive
  });

  it("rejects past dates and accepts today", () => {
    expect(parseBookingForm(form({ ...valid, preferred_date: "2026-10-12" }), page, NOW).errors.preferred_date).toMatch(/today or a later/);
    expect(parseBookingForm(form({ ...valid, preferred_date: "2026-10-13" }), page, NOW).ok).toBe(true);
  });

  it("keeps only active services and maps detail counts to their labels", () => {
    const r = parseBookingForm(form({ ...valid, services: ["carpet", "old", "bogus"], detail_carpet: "3" }), page, NOW);
    expect(r.booking.services).toEqual(["Carpet cleaning"]);
    expect(r.booking.details).toEqual({ "Number of rooms": 3 });
  });

  it("rejects a non-numeric detail", () => {
    expect(parseBookingForm(form({ ...valid, detail_carpet: "-1" }), page, NOW).errors.detail_carpet).toBeTruthy();
  });

  it("drops an unknown period or heard-from value instead of storing it", () => {
    const r = parseBookingForm(form({ ...valid, preferred_period: "midnight", heard_from: "<script>" }), page, NOW);
    expect(r.booking.preferred_period).toBeNull();
    expect(r.booking.heard_from).toBe("");
  });

  it("matches ZIP prefixes", () => {
    expect(zipAccepted("30062", ["300"])).toBe(true);
    expect(zipAccepted("31062", ["300", "3007"])).toBe(false);
    expect(zipAccepted("30062", [])).toBe(false);
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

  it("hides the reviews section when no real reviews are configured", () => {
    expect(html).not.toContain("What customers say");
    const withReview = renderBookingPage({ page: { ...page, reviews: [{ author: "Ana", text: "Great job" }] }, base: "https://x/book/p", texts, today: "2026-10-13" });
    expect(withReview).toContain("What customers say");
  });

  it("never prints a price that isn't configured", () => {
    expect(html).not.toMatch(/Starting at/);
    const priced = renderBookingPage({ page: { ...page, services: [{ id: "a", name: "A", from_price: 99, active: true }] }, base: "https://x/book/p", texts, today: "2026-10-13" });
    expect(priced).toContain("Starting at $99");
  });

  it("escapes admin-entered content", () => {
    const evil = renderBookingPage({ page: { ...page, hero_title: '<img src=x onerror="alert(1)">', business_name: "A</script><script>x()</script>" }, base: "https://x/book/p", texts, today: "2026-10-13" });
    expect(evil).not.toContain("<img src=x");
    expect(evil).not.toContain("</script><script>x()");
  });

  it("re-renders errors with the typed values and the phone as an alternative", () => {
    const again = renderBookingPage({ page, base: "https://x/book/p", texts, today: "2026-10-13", values: { first_name: "Jane", sms_consent: true }, errors: { zip: "We don't serve this area yet" } });
    expect(again).toContain('value="Jane"');
    expect(again).toContain("We don&#39;t serve this area yet");
    expect(again).toMatch(/id="sms_consent"[^>]*checked/);
    expect(again).toContain('href="tel:4045550100"');
  });

  it("shows the confirmation with the first name instead of the form", () => {
    const done = renderBookingPage({ page, base: "https://x/book/p", texts, today: "2026-10-13", booked: "Jane" });
    expect(done).toContain("Thanks, Jane!");
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
