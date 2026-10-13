// Display + editing helpers for the booking page admin and the consent
// badges. The actual send-gate (canSendMarketing) is server-side, in
// web/api/_lib/consent.js — nothing here decides whether a message may go out.
import type { BookingPage, ConsentRecord, ConsentState, ConsentTextKind } from "./types";

// Same wording as version 1 in migration 2026-10-13_11, for companies that
// create their booking page later from the admin screen.
export const DEFAULT_CONSENT_TEXTS: Record<ConsentTextKind, string> = {
  sms: "Yes, I agree to receive marketing and promotional text messages from {Business} at the mobile number provided. Consent is not a condition of purchase. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. See our SMS Terms and Privacy Policy.",
  email: "Yes, send me offers and seasonal reminders by email. You can unsubscribe anytime.",
  transactional: "By booking, you agree to receive texts and emails about this appointment (confirmations, reminders, and updates)."
};

export const CONSENT_STATE_LABELS: Record<ConsentState, string> = {
  opted_in: "opted in",
  not_opted_in: "not opted in",
  suppressed: "suppressed"
};

export const CONSENT_SOURCE_LABELS: Record<ConsentRecord["source"], string> = {
  booking_page: "Booking page",
  import: "Import",
  manual: "Manual",
  inbound_stop: "STOP reply",
  unsubscribe: "Email unsubscribe"
};

// "SMS: opted in" — the badge text on a lead/client.
export function consentBadge(channel: "sms" | "email", state: ConsentState | undefined): string {
  return `${channel === "sms" ? "SMS" : "Email"}: ${CONSENT_STATE_LABELS[state || "not_opted_in"]}`;
}

export function renderConsentText(template: string, businessName: string): string {
  return template.replace(/\{Business\}/g, businessName.trim());
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Textarea → list: one per line or comma-separated, trimmed, deduped.
export function parseList(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean))];
}

export function parseZipPrefixes(value: string): { prefixes: string[]; invalid: string[] } {
  const items = parseList(value);
  return {
    prefixes: items.filter(z => /^\d{1,5}$/.test(z)),
    invalid: items.filter(z => !/^\d{1,5}$/.test(z))
  };
}

// What's still missing before a page can be switched on — mirrors the
// booking_pages_activation check constraint, so the admin sees it before
// the database says no. Returns codes; the UI words them ("bp.missing.*").
export type ActivationProblem = "address" | "phone" | "email" | "zips";
export function activationProblems(page: Pick<BookingPage, "address_line" | "address_city" | "address_state" | "address_zip" | "phone" | "email" | "zip_prefixes">): ActivationProblem[] {
  const missing: ActivationProblem[] = [];
  if (!page.address_line || !page.address_city || !page.address_state || !page.address_zip) missing.push("address");
  if (!page.phone) missing.push("phone");
  if (!page.email) missing.push("email");
  if (!page.zip_prefixes.length) missing.push("zips");
  return missing;
}

export function isSafeLogoUrl(url: string): boolean {
  return url === "" || /^https:\/\/\S+$/i.test(url) || /^\/[^/\s]\S*$/.test(url);
}
