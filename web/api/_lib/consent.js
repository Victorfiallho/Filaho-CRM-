// Marketing-consent rules. Pure functions only (no DB, no clock unless
// passed in) so consent.test.js can pin every case; consentStore.js does the
// loading. Every future marketing SMS/email send MUST go through
// canSendMarketing() — there is deliberately no other "is this ok to send"
// check anywhere.
import { isWithinSmsWindow } from "./usTime.js";

// ── normalization (the keys consent_records.value / suppression_list.value use)

// US numbers only: 10 digits, or 11 starting with 1. Returns "+1XXXXXXXXXX"
// or null. Rejects N11/0/1-leading area and exchange codes, which can't be
// real mobile numbers.
export function toE164(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

export function normalizeEmail(email) {
  const v = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function contactValue(contact, channel) {
  if (!contact) return null;
  return channel === "sms" ? toE164(contact.phone_e164 || contact.phone) : normalizeEmail(contact.email);
}

// ── consent text

export function renderConsentText(template, businessName) {
  return String(template || "").replace(/\{Business\}/g, String(businessName || "").trim());
}

// ── state

// Most recent record wins. `records` = this contact's consent_records for
// one channel, any order.
export function latestConsent(records, channel) {
  return (records || [])
    .filter(r => r.channel === channel && (r.purpose || "marketing") === "marketing")
    .reduce((latest, r) => (!latest || new Date(r.created_at) > new Date(latest.created_at) ? r : latest), null);
}

// "opted_in" | "not_opted_in" | "suppressed" — the badge the CRM shows.
export function consentState(records, channel, suppressed) {
  if (suppressed) return "suppressed";
  return latestConsent(records, channel)?.granted ? "opted_in" : "not_opted_in";
}

// ── the gate

export const REASONS = {
  ok: "Allowed.",
  invalid_channel: "Unknown channel.",
  no_contact_value: "The contact has no valid phone/email for this channel.",
  suppressed: "The phone/email is on the suppression list.",
  no_consent: "No marketing SMS opt-in on record.",
  consent_revoked: "The contact's most recent SMS consent record is a revocation.",
  outside_sms_hours: "Outside 8am–9pm in the contact's local time."
};

/**
 * @param {object} contact     { phone, phone_e164, email, state, zip }
 * @param {"sms"|"email"} channel
 * @param {object} ctx
 * @param {object[]} ctx.consents   the contact's consent_records (any channel)
 * @param {string[]} ctx.suppressed suppression_list values for this channel
 *                                 that match the contact (or the whole set)
 * @param {Date}     [ctx.now]
 * @returns {{ allowed: boolean, reason: keyof REASONS, message: string }}
 */
export function canSendMarketing(contact, channel, { consents = [], suppressed = [], now = new Date() } = {}) {
  const result = reason => ({ allowed: reason === "ok", reason, message: REASONS[reason] });

  if (channel !== "sms" && channel !== "email") return result("invalid_channel");
  const value = contactValue(contact, channel);
  if (!value) return result("no_contact_value");
  if (new Set(suppressed).has(value)) return result("suppressed");

  if (channel === "sms") {
    // TCPA: marketing texts need prior express written consent. Only a
    // granted=true record counts, and only if nothing newer revoked it.
    const latest = latestConsent(consents, "sms");
    if (!latest) return result("no_consent");
    if (!latest.granted) {
      const everGranted = consents.some(r => r.channel === "sms" && r.granted);
      return result(everGranted ? "consent_revoked" : "no_consent");
    }
    if (!isWithinSmsWindow(contact, now)) return result("outside_sms_hours");
    return result("ok");
  }

  // Email: CAN-SPAM is opt-out, not opt-in — only the suppression list
  // (unsubscribes, bounces, complaints) blocks it.
  return result("ok");
}

// ── inbound SMS keywords

// The six CTIA opt-out keywords, plus REVOKE/OPTOUT/"OPT OUT": the FCC's 2024
// TCPA order (effective April 2025) requires honoring a revocation made "by
// any reasonable means", and lists those words as per-se revocations.
const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
// Words that mean opt-out even inside a short sentence ("Stop texting me",
// "please unsubscribe me"). END/QUIT/CANCEL only count on their own —
// "cancel my appointment" or "see you at the end" aren't revocations.
const UNAMBIGUOUS_STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "REVOKE", "OPTOUT"];
const SHORT_REPLY_WORDS = 6;
const HELP_WORDS = ["HELP", "INFO"];

// "stop" | "help" | null.
export function classifyInboundSms(body) {
  const words = String(body || "").toUpperCase().replace(/OPT[\s-]+OUT/g, "OPTOUT").split(/[^A-Z]+/).filter(Boolean);
  if (words.length === 1 && STOP_WORDS.includes(words[0])) return "stop";
  if (words.length <= SHORT_REPLY_WORDS && words.some(w => UNAMBIGUOUS_STOP_WORDS.includes(w))) return "stop";
  if (words.length === 1 && HELP_WORDS.includes(words[0])) return "help";
  return null;
}
