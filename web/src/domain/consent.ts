// Display helpers for consent. Whether a message may be sent is decided
// only server-side, by canSendMarketing() in web/api/_lib/consent.js.
import type { ConsentState } from "./types";

export const CONSENT_STATE_LABELS: Record<ConsentState, string> = {
  opted_in: "opted in",
  not_opted_in: "not opted in",
  suppressed: "suppressed"
};

export function renderConsentText(template: string, businessName: string): string {
  return template.replace(/\{Business\}/g, businessName.trim());
}
