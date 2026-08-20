import { describe, expect, it } from "vitest";
import { buildCompanyIcsCalendar, calendarDateString, googleCalendarCreateUrl, icsText } from "./calendarExport";
import type { Job } from "./types";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1", company_id: "peach_fresh", customer_id: "cust_1", lead_id: null, title: "Deep clean",
    status: "planned", service_type: "Deep Cleaning", scheduled_date: "2024-02-01", address: "123 Main St",
    city: "Atlanta", state: "GA", zip: "30303", estimated_value: 200, drive_folder_url: "",
    lat: "", lng: "", created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("calendarDateString", () => {
  it("strips dashes from an ISO date", () => {
    expect(calendarDateString("2024-02-01")).toBe("20240201");
  });
});

describe("icsText", () => {
  it("escapes commas, semicolons, backslashes, and newlines", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
});

describe("googleCalendarCreateUrl", () => {
  it("builds a Google Calendar template link with the job's details", () => {
    const url = googleCalendarCreateUrl(job(), "Peach Fresh Cleaning");
    // The end date is computed via a local-time Date + toISOString round-trip
    // (same as the implementation), so it's derived here too rather than
    // hardcoded — that calculation can land on a different UTC day depending
    // on the machine's timezone, same as the original app.js behavior.
    const endDate = new Date("2024-02-01T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    const expectedEnd = calendarDateString(endDate.toISOString().slice(0, 10));
    expect(url).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(url).toContain(`dates=20240201/${expectedEnd}`);
    expect(url).toContain(encodeURIComponent("Peach Fresh Cleaning: Deep clean"));
  });
});

describe("buildCompanyIcsCalendar", () => {
  it("wraps each job in a VEVENT block with the CRM job id", () => {
    const ics = buildCompanyIcsCalendar("Peach Fresh Cleaning", [job()]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:job_1@fialho-crm");
    expect(ics).toContain("SUMMARY:Peach Fresh Cleaning: Deep clean");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("produces an empty-but-valid calendar for no jobs", () => {
    const ics = buildCompanyIcsCalendar("Peach Fresh Cleaning", []);
    expect(ics).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fialho Home Improvement//EN\r\nEND:VCALENDAR");
  });
});
