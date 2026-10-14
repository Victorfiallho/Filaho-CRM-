import { describe, expect, it } from "vitest";
import { consentBadge, renderConsentText } from "./consent";

describe("consentBadge", () => {
  it("formats the per-channel state", () => {
    expect(consentBadge("sms", "opted_in")).toBe("SMS: opted in");
    expect(consentBadge("sms", "suppressed")).toBe("SMS: suppressed");
    expect(consentBadge("email", undefined)).toBe("Email: not opted in");
  });
});

describe("consent texts", () => {
  it("renders {Business} placeholders", () => {
    expect(renderConsentText("texts from {Business}.", "Peach Fresh")).toBe("texts from Peach Fresh.");
  });
});
