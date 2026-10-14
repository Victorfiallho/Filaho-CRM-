import { describe, expect, it } from "vitest";
import { renderConsentText } from "./consent";

describe("consent texts", () => {
  it("renders {Business} placeholders", () => {
    expect(renderConsentText("texts from {Business}.", "Peach Fresh")).toBe("texts from Peach Fresh.");
  });
});
