// Display helpers for the consent badges. The actual send-gate (canSendMarketing) is server-side, in
// web/api/_lib/consent.js — nothing here decides whether a message may go out.
import type { ConsentRecord, ConsentState } from "./types";

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
