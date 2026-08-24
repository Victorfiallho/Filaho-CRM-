import { buildCompanyIcsCalendar, googleCalendarCreateUrl } from "../domain/calendarExport";
import { useJobs } from "../data/hooks";
import { downloadText } from "../lib/downloadText";
import { toast } from "../lib/toast";
import { useCalendar } from "../state/CalendarContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import type { Job } from "../domain/types";

// Ported verbatim from app.js (renderCalendar, moveCalendar, openQuickJob,
// downloadCompanyIcs).
export default function Calendar() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { calendarDate, setCalendarDate } = useCalendar();
  const { openRecordModal } = useModal();

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const monthJobs = jobs.filter(job => {
    if (!job.scheduled_date) return false;
    const d = new Date(job.scheduled_date + "T00:00:00");
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const today = new Date().toISOString().slice(0, 10);

  const cells: { date: string; day: number }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
  }

  const moveCalendar = (delta: number) => setCalendarDate(new Date(year, month + delta, 1));

  const openQuickJob = (date: string) => openRecordModal("job", undefined, { scheduled_date: date });

  const downloadCompanyIcs = () => {
    const scheduled = jobs.filter(j => j.scheduled_date);
    if (!scheduled.length) { toast("No scheduled jobs to export."); return; }
    downloadText(`${activeCompany?.slug}-jobs.ics`, buildCompanyIcsCalendar(activeCompany?.name || "", scheduled), "text/calendar");
  };

  const upcoming = [...jobs].filter(j => j.scheduled_date).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 10);

  return (
    <div className="grid two">
      <section className="card">
        <div className="card-h">
          <div><h3>Internal job calendar</h3><span className="sub">Company events before Google sync</span></div>
          <div className="tabs">
            <button className="btn ghost slim" onClick={() => moveCalendar(-1)}>Prev</button>
            <button className="btn ghost slim" onClick={() => setCalendarDate(new Date())}>Today</button>
            <button className="btn ghost slim" onClick={() => moveCalendar(1)}>Next</button>
            <button className="btn ghost slim" onClick={downloadCompanyIcs}>Export ICS</button>
          </div>
        </div>
        <div className="card-b">
          <h3>{calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
          <div className="calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div className="cal-head" key={d}>{d}</div>)}
            {Array.from({ length: startPad }).map((_, i) => <div className="cal-cell muted" key={`pad${i}`} />)}
            {cells.map(({ day, date }) => {
              const dayJobs = monthJobs.filter(job => job.scheduled_date === date);
              return (
                <button key={date} className={`cal-cell${date === today ? " today" : ""}`} onClick={() => openQuickJob(date)}>
                  <span className="cal-day">{day}</span>
                  {dayJobs.slice(0, 3).map(job => <span className="cal-job" key={job.id}>{job.title} · {job.status || "planned"}</span>)}
                  {dayJobs.length > 3 && <span className="cal-more">+{dayJobs.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section className="card self-start">
        <div className="card-h"><h3>Upcoming jobs</h3><button className="btn slim" onClick={() => openRecordModal("job")}>Add job</button></div>
        <div className="card-b">
          {upcoming.length
            ? upcoming.map((job: Job) => (
              <div className="route-stop" key={job.id}>
                <b>{job.scheduled_date} · {job.title}</b>
                <span>{[job.city, job.zip, job.service_type].filter(Boolean).join(" | ")}</span>
                <a href={googleCalendarCreateUrl(job, activeCompany?.name || "")} target="_blank" rel="noreferrer">Open in Google Calendar</a>
              </div>
            ))
            : <div className="empty">No scheduled jobs yet</div>}
        </div>
      </section>
    </div>
  );
}
