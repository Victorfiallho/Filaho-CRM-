import { describe, expect, it } from "vitest";
import { canSendMarketing, classifyInboundSms, normalizeEmail, renderConsentText, toE164 } from "./consent.js";
import { isWithinSmsWindow, timeZonesFor, todayIn, zipToState } from "./usTime.js";

// 2026-10-13 18:00 UTC = 2:00pm in Atlanta (EDT, UTC-4).
const AFTERNOON_ET = new Date("2026-10-13T18:00:00Z");
// 2026-10-14 02:00 UTC = 10:00pm Oct 13 in Atlanta.
const NIGHT_ET = new Date("2026-10-14T02:00:00Z");

const contact = { phone: "(404) 555-0123", email: "Jane@Example.com", state: "GA", zip: "30062" };
const rec = (channel, granted, created_at, source = "booking_page") => ({ channel, purpose: "marketing", granted, created_at, source });

describe("canSendMarketing: SMS", () => {
  it("blocks when there is no consent record at all (e.g. a Thumbtack import)", () => {
    expect(canSendMarketing(contact, "sms", { consents: [], now: AFTERNOON_ET })).toMatchObject({ allowed: false, reason: "no_consent" });
  });

  it("blocks when the only record is granted=false (box left unchecked)", () => {
    const consents = [rec("sms", false, "2026-10-01T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, now: AFTERNOON_ET })).toMatchObject({ allowed: false, reason: "no_consent" });
  });

  it("blocks when consent was given and later revoked", () => {
    const consents = [rec("sms", true, "2026-10-01T12:00:00Z"), rec("sms", false, "2026-10-05T12:00:00Z", "inbound_stop")];
    expect(canSendMarketing(contact, "sms", { consents, now: AFTERNOON_ET })).toMatchObject({ allowed: false, reason: "consent_revoked" });
  });

  it("uses the most recent record regardless of array order", () => {
    const consents = [rec("sms", false, "2026-10-05T12:00:00Z", "inbound_stop"), rec("sms", true, "2026-10-09T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, now: AFTERNOON_ET }).allowed).toBe(true);
  });

  it("blocks when the number is on the suppression list, even with consent", () => {
    const consents = [rec("sms", true, "2026-10-01T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, suppressed: ["+14045550123"], now: AFTERNOON_ET })).toMatchObject({ allowed: false, reason: "suppressed" });
  });

  it("blocks outside 8am–9pm local time", () => {
    const consents = [rec("sms", true, "2026-10-01T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, now: NIGHT_ET })).toMatchObject({ allowed: false, reason: "outside_sms_hours" });
  });

  it("allows with a current opt-in, not suppressed, inside the window", () => {
    const consents = [rec("sms", true, "2026-10-01T12:00:00Z"), rec("email", false, "2026-10-01T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, now: AFTERNOON_ET })).toEqual({ allowed: true, reason: "ok", message: "Allowed." });
  });

  it("ignores email consent when deciding SMS", () => {
    const consents = [rec("email", true, "2026-10-01T12:00:00Z")];
    expect(canSendMarketing(contact, "sms", { consents, now: AFTERNOON_ET }).reason).toBe("no_consent");
  });

  it("blocks a contact without a valid phone", () => {
    expect(canSendMarketing({ ...contact, phone: "555-0123" }, "sms", { consents: [rec("sms", true, "2026-10-01T12:00:00Z")], now: AFTERNOON_ET }).reason).toBe("no_contact_value");
  });

  it("rejects an unknown channel", () => {
    expect(canSendMarketing(contact, "whatsapp", {}).reason).toBe("invalid_channel");
  });
});

describe("canSendMarketing: time zones", () => {
  const consents = [rec("sms", true, "2026-10-01T12:00:00Z")];
  // 2026-10-13 13:30 UTC = 9:30am ET, 8:30am CT, 7:30am MT, 6:30am PT.
  const morning = new Date("2026-10-13T13:30:00Z");

  it("resolves the zone from the state", () => {
    expect(canSendMarketing({ ...contact, state: "CA", zip: "" }, "sms", { consents, now: morning }).reason).toBe("outside_sms_hours");
    expect(canSendMarketing({ ...contact, state: "GA" }, "sms", { consents, now: morning }).allowed).toBe(true);
  });

  it("falls back to the ZIP when there's no state", () => {
    expect(canSendMarketing({ ...contact, state: "", zip: "90210" }, "sms", { consents, now: morning }).reason).toBe("outside_sms_hours");
  });

  it("defaults to America/New_York when neither resolves", () => {
    expect(timeZonesFor({ state: "", zip: "" })).toEqual(["America/New_York"]);
    expect(canSendMarketing({ ...contact, state: "", zip: "" }, "sms", { consents, now: morning }).allowed).toBe(true);
  });

  it("requires the window in every zone of a split state (FL panhandle is Central)", () => {
    // 12:30 UTC = 8:30am ET but 7:30am CT.
    expect(isWithinSmsWindow({ state: "FL" }, new Date("2026-10-13T12:30:00Z"))).toBe(false);
    expect(isWithinSmsWindow({ state: "GA" }, new Date("2026-10-13T12:30:00Z"))).toBe(true);
  });

  it("treats 9:00pm as already outside the window", () => {
    // 2026-10-14 01:00 UTC = 9:00pm ET; 00:59 UTC = 8:59pm.
    expect(isWithinSmsWindow({ state: "GA" }, new Date("2026-10-14T01:00:00Z"))).toBe(false);
    expect(isWithinSmsWindow({ state: "GA" }, new Date("2026-10-14T00:59:00Z"))).toBe(true);
  });
});

describe("canSendMarketing: email", () => {
  it("allows without opt-in (CAN-SPAM is opt-out)", () => {
    expect(canSendMarketing(contact, "email", { consents: [], now: NIGHT_ET }).allowed).toBe(true);
  });

  it("blocks a suppressed address, matching case-insensitively", () => {
    expect(canSendMarketing(contact, "email", { suppressed: ["jane@example.com"] })).toMatchObject({ allowed: false, reason: "suppressed" });
  });

  it("blocks a contact without a valid email", () => {
    expect(canSendMarketing({ ...contact, email: "nope" }, "email", {}).reason).toBe("no_contact_value");
  });
});


describe("normalization", () => {
  it("formats US numbers as E.164", () => {
    expect(toE164("(404) 555-0123")).toBe("+14045550123");
    expect(toE164("1-404-555-0123")).toBe("+14045550123");
    expect(toE164("+1 404 555 0123")).toBe("+14045550123");
  });

  it("rejects numbers that can't be US mobiles", () => {
    expect(toE164("555-0123")).toBeNull();
    expect(toE164("(104) 555-0123")).toBeNull(); // area code can't start with 1
    expect(toE164("(404) 155-0123")).toBeNull(); // exchange can't start with 1
    expect(toE164("44 20 7946 0958")).toBeNull();
  });

  it("lowercases and validates email", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail("jane@")).toBeNull();
  });

  it("renders {Business} into the consent text", () => {
    expect(renderConsentText("messages from {Business}. {Business} rocks", "Peach Fresh")).toBe("messages from Peach Fresh. Peach Fresh rocks");
  });
});

describe("classifyInboundSms", () => {
  it.each(["STOP", "stop", "Stop.", " STOPALL ", "unsubscribe", "Cancel", "END", "quit", "opt out", "REVOKE"])("treats %j as an opt-out", body => {
    expect(classifyInboundSms(body)).toBe("stop");
  });

  it("catches a stop word inside a short reply", () => {
    expect(classifyInboundSms("Please stop texting me")).toBe("stop");
    expect(classifyInboundSms("unsubscribe me now")).toBe("stop");
  });

  it("doesn't treat ordinary words in a sentence as an opt-out", () => {
    expect(classifyInboundSms("Can I cancel my appointment?")).toBeNull();
    expect(classifyInboundSms("see you at the end of the day")).toBeNull();
  });

  it("recognizes HELP only as the whole message", () => {
    expect(classifyInboundSms("HELP")).toBe("help");
    expect(classifyInboundSms("info")).toBe("help");
    expect(classifyInboundSms("I need help moving the couch")).toBeNull();
  });
});

describe("usTime", () => {
  it("maps ZIP prefixes to states", () => {
    expect(zipToState("30062")).toBe("GA");
    expect(zipToState("39901")).toBe("GA");
    expect(zipToState("32501")).toBe("FL");
    expect(zipToState("10001")).toBe("NY");
    expect(zipToState("123")).toBeNull();
  });

  it("computes today in Eastern time", () => {
    // 03:00 UTC on Oct 14 is still Oct 13 in Atlanta.
    expect(todayIn("America/New_York", new Date("2026-10-14T03:00:00Z"))).toBe("2026-10-13");
  });
});
