import { describe, expect, it } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
  it("reads .message off a real Error", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads .message off a plain error-shaped object (e.g. Supabase's PostgrestError, not `instanceof Error`)", () => {
    const postgrestError = { message: "invalid input syntax for type numeric", details: "", hint: "", code: "22P02" };
    expect(errorMessage(postgrestError, "fallback")).toBe("invalid input syntax for type numeric");
  });

  it("falls back when there's no usable message", () => {
    expect(errorMessage(null, "fallback")).toBe("fallback");
    expect(errorMessage("just a string", "fallback")).toBe("fallback");
    expect(errorMessage({}, "fallback")).toBe("fallback");
  });
});
