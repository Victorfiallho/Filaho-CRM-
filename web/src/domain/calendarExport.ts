// Ported verbatim from app.js (googleCalendarCreateUrl, downloadCompanyIcs's ICS
// text building, calendarDateString, icsText). `company()` becomes an explicit
// companyName parameter.
import type { Job } from "./types";

export function calendarDateString(date: string): string {
  return String(date || "").replace(/-/g, "");
}

export function icsText(value: string): string {
  return String(value || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

export function googleCalendarCreateUrl(job: Job, companyName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const start = calendarDateString(job.scheduled_date || today);
  const endDate = new Date((job.scheduled_date || today) + "T00:00:00");
  endDate.setDate(endDate.getDate() + 1);
  const end = calendarDateString(endDate.toISOString().slice(0, 10));
  const text = encodeURIComponent(`${companyName}: ${job.title}`);
  const location = encodeURIComponent([job.address, job.city, job.state, job.zip].filter(Boolean).join(", "));
  const details = encodeURIComponent(`Service: ${job.service_type || ""}\nStatus: ${job.status || ""}\nCRM job id: ${job.id}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&location=${location}&details=${details}`;
}

export function buildCompanyIcsCalendar(companyName: string, jobs: Job[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fialho CRM//EN"];
  jobs.forEach(job => {
    const start = calendarDateString(job.scheduled_date);
    const endDate = new Date(job.scheduled_date + "T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${job.id}@fialho-crm`,
      `DTSTAMP:${calendarDateString(new Date().toISOString().slice(0, 10))}T120000Z`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${calendarDateString(endDate.toISOString().slice(0, 10))}`,
      `SUMMARY:${icsText(companyName + ": " + job.title)}`,
      `LOCATION:${icsText([job.address, job.city, job.state, job.zip].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsText(`Service: ${job.service_type || ""}\\nStatus: ${job.status || ""}\\nCRM job id: ${job.id}`)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
