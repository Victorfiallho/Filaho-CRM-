// Display helpers for the consent badges. The actual send-gate (canSendMarketing) is server-side, in
// web/api/_lib/consent.js — nothing here decides whether a message may go out.
import type { ConsentState } from "./types";

export const CONSENT_STATE_LABELS: Record<ConsentState, string> = {
  opted_in: "opted in",
  not_opted_in: "not opted in",
  suppressed: "suppressed"
};

export function renderConsentText(template: string, businessName: string): string {
  return template.replace(/\{Business\}/g, businessName.trim());
}
