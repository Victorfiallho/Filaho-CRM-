import { describe, expect, it } from "vitest";
import {
  classifyCalendarEvent, companyFromCalendarEvent, customerNameFromTitle, dateFromIcs,
  decodeIcsValue, jobFromIcsEvent, parseAddressParts, parseICS, serviceFromTitle, valueFromText
} from "./ics";

describe("decodeIcsValue", () => {
  it("unescapes ICS escape sequences", () => {
    expect(decodeIcsValue("Line1\\nLine2")).toBe("Line1\nLine2");
    expect(decodeIcsValue("a\\, b\\; c")).toBe("a, b; c");
    expect(decodeIcsValue("back\\\\slash")).toBe("back\\slash");
  });
});

describe("parseICS", () => {
  it("parses events between BEGIN:VEVENT/END:VEVENT", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:evt-1",
      "SUMMARY:Deep Cleaning - Jane Doe",
      "DTSTART:20240201T120000Z",
      "LOCATION:123 Main St\\, Atlanta\\, GA 30303",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const events = parseICS(text);
    expect(events).toHaveLength(1);
    expect(events[0].UID).toBe("evt-1");
    expect(events[0].SUMMARY).toBe("Deep Cleaning - Jane Doe");
    expect(events[0].LOCATION).toBe("123 Main St, Atlanta, GA 30303");
  });

  it("returns no events when there are none", () => {
    expect(parseICS("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
  });
});

describe("parseAddressParts", () => {
  it("splits address, city, state, zip from a comma-joined location", () => {
    expect(parseAddressParts("123 Main St, Atlanta, GA 30303")).toEqual({
      address: "123 Main St", city: "Atlanta", state: "GA", zip: "30303"
    });
  });

  it("falls back to scanning for a bare zip when state/zip aren't in the expected slot", () => {
    expect(parseAddressParts("123 Main St, Atlanta")).toEqual({
      address: "123 Main St", city: "Atlanta", state: "", zip: ""
    });
  });
});

describe("dateFromIcs", () => {
  it("converts an all-day 8-digit date", () => {
    expect(dateFromIcs("20240201")).toBe("2024-02-01");
  });

  it("converts a UTC timestamp (mid-day, so local-time rendering is stable)", () => {
    expect(dateFromIcs("20240201T120000Z")).toBe("2024-02-01");
  });

  it("returns an empty string for unparseable input", () => {
    expect(dateFromIcs("not-a-date")).toBe("");
    expect(dateFromIcs(undefined)).toBe("");
  });
});

describe("valueFromText", () => {
  it("extracts a dollar amount", () => {
    expect(valueFromText("Estimate: $1,250.50 total")).toBe(1250.5);
  });

  it("extracts a 'Total - N' amount when there's no dollar sign", () => {
    expect(valueFromText("Total - 300")).toBe(300);
  });

  it("returns 0 when no amount is found", () => {
    expect(valueFromText("no numbers here")).toBe(0);
  });
});

describe("serviceFromTitle", () => {
  const services = ["Deep Cleaning", "Recurring Cleaning", "Move-in/Move-out"];

  it("matches a service mentioned in the title", () => {
    expect(serviceFromTitle("Deep Cleaning for Jane Doe", services)).toBe("Deep Cleaning");
  });

  it("falls back to the first service when nothing matches", () => {
    expect(serviceFromTitle("Random event", services)).toBe("Deep Cleaning");
  });
});

describe("customerNameFromTitle", () => {
  it("takes the part before ' - '", () => {
    expect(customerNameFromTitle("Jane Doe - Deep Cleaning")).toBe("Jane Doe");
  });

  it("returns the whole title when there's no separator", () => {
    expect(customerNameFromTitle("Deep Cleaning")).toBe("Deep Cleaning");
  });
});

describe("companyFromCalendarEvent", () => {
  it("routes Arca events", () => {
    expect(companyFromCalendarEvent("Arca install", "", "peach_fresh")).toBe("arca_cabinets");
  });

  it("routes flooring events", () => {
    expect(companyFromCalendarEvent("Floor refinishing", "", "peach_fresh")).toBe("peach_state_flooring");
  });

  it("routes cabinet events", () => {
    expect(companyFromCalendarEvent("Kitchen cabinet install", "", "peach_fresh")).toBe("wish_cabinets");
  });

  it("routes cleaning events", () => {
    expect(companyFromCalendarEvent("Deep cleaning job", "", "wish_cabinets")).toBe("peach_fresh");
  });

  it("falls back to the given company when nothing matches", () => {
    expect(companyFromCalendarEvent("Dentist appointment", "", "peach_fresh")).toBe("peach_fresh");
  });
});

describe("classifyCalendarEvent", () => {
  it("flags known personal keywords as personal/skip", () => {
    const result = classifyCalendarEvent({ title: "Birthday party" }, {});
    expect(result).toEqual({ label: "personal", reason: "Birthday/personal", skip: true });
  });

  it("flags bare 'off' as time off", () => {
    const result = classifyCalendarEvent({ title: "Off" }, {});
    expect(result).toEqual({ label: "personal", reason: "Time off", skip: true });
  });

  it("flags work-keyword titles as job", () => {
    const result = classifyCalendarEvent({ title: "Kitchen cabinet install" }, {});
    expect(result.label).toBe("job");
    expect(result.reason).toBe("Work keywords found");
    expect(result.skip).toBe(false);
  });

  it("flags an address with no work keywords as job (has job details)", () => {
    const result = classifyCalendarEvent({ title: "Follow up", address: "123 Main St" }, {});
    expect(result.label).toBe("job");
    expect(result.reason).toBe("Has job details");
  });

  it("flags no address/value/keywords as needing review", () => {
    const result = classifyCalendarEvent({ title: "Meeting with team" }, {});
    expect(result.label).toBe("review");
    expect(result.skip).toBe(false);
  });
});

describe("jobFromIcsEvent", () => {
  it("builds a job record, using the ACTIVE company's services (not the routed company's)", () => {
    // Preserves an app.js quirk: service_type is resolved from whatever company is
    // active at import time, even though the event itself gets routed elsewhere.
    const event = {
      SUMMARY: "Jane Doe - Kitchen cabinet install",
      LOCATION: "123 Main St, Atlanta, GA 30303",
      DTSTART: "20240201",
      DESCRIPTION: "Total - 500"
    };
    const activeCompanyServices = ["Deep Cleaning", "Recurring Cleaning"];
    const record = jobFromIcsEvent(event, "peach_fresh", activeCompanyServices);
    expect(record.company_id).toBe("wish_cabinets");
    expect(record.service_type).toBe("Deep Cleaning");
    expect(record.title).toBe("Jane Doe - Kitchen cabinet install");
    expect(record.customer_name).toBe("Jane Doe");
    expect(record.scheduled_date).toBe("2024-02-01");
    expect(record.estimated_value).toBe(500);
    expect(record.city).toBe("Atlanta");
  });
});
