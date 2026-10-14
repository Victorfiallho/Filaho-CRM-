import { describe, expect, it } from "vitest";
import { bookingPath, bookingSlug } from "./booking";

describe("booking page address", () => {
  it("matches the SQL booking_slug() rule", () => {
    expect(bookingSlug("peach_state_flooring")).toBe("peach-state-flooring");
    expect(bookingSlug("wish_cabinets")).toBe("wish-cabinets");
    expect(bookingSlug("_Odd__Id_")).toBe("odd-id");
  });

  it("builds the public path", () => {
    expect(bookingPath("peach_fresh")).toBe("/book/peach-fresh");
  });
});
