import { Calendar as CalendarIcon, CheckCircle, Clock, MapPin, Navigation } from "lucide-react";
import PageSkeleton from "../components/PageSkeleton";
import { buildCompanyIcsCalendar, googleCalendarCreateUrl } from "../domain/calendarExport";
import { useJobs } from "../data/hooks";
import { downloadText } from "../lib/downloadText";
import { toast } from "../lib/toast";
import { useCalendar } from "../state/CalendarContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import type { Job } from "../domain/types";

// Deterministic (not random) so the same job always gets the same chip color
// across re-renders — keyed on service_type so same-type jobs visually group,
// falling back to the job id for jobs with no service_type set.
const CHIP_COLORS = [
  { bg: "var(--blue-soft)", fg: "var(--blue)" },
  { bg: "var(--success-soft)", fg: "#047857" },
  { bg: "var(--purple-soft)", fg: "var(--purple)" },
  { bg: "var(--yellow-soft)", fg: "var(--yellow)" },
  { bg: "var(--brand-soft)", fg: "var(--brand)" }
];
function chipColorFor(job: Job) {
  const key = job.service_type || job.id;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

function dateBadge(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return { month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(), day: d.getDate() };
}

function mapsSearchUrl(job: Job) {
  const query = [job.address, job.city, job.state, job.zip].filter(Boolean).join(", ") || job.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Ported verbatim from app.js (renderCalendar, moveCalendar, openQuickJob,
// downloadCompanyIcs).
export default function Calendar() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { data: jobs = [], isLoading } = useJobs(activeCompanyId);
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

  const scheduledCount = monthJobs.length;
  const pendingCount = monthJobs.filter(j => (j.status || "planned") === "planned").length;
  const completedCount = monthJobs.filter(j => j.status === "complete").length;

  if (isLoading) return <PageSkeleton cards={2} />;

  return (
    <div className="grid two view-enter">
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
                  {dayJobs.slice(0, 3).map(job => {
                    const c = chipColorFor(job);
                    return (
                      <span className="cal-job" key={job.id} style={{ background: c.bg, color: c.fg }}>
                        <span className="cal-job-dot" style={{ background: c.fg }} />
                        {job.title}
                      </span>
                    );
                  })}
                  {dayJobs.length > 3 && <span className="cal-more">+{dayJobs.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <div className="grid self-start">
      <section className="card">
        <div className="card-h"><h3>Upcoming jobs</h3><button className="btn slim" onClick={() => openRecordModal("job")}>Add job</button></div>
        <div className="card-b">
          {upcoming.length
            ? <>
              {upcoming.map((job: Job) => {
                const badge = dateBadge(job.scheduled_date);
                const status = job.status || "planned";
                return (
                  <div className="upcoming-job" key={job.id}>
                    <div className="upcoming-date">
                      <span className="upcoming-date-month">{badge.month}</span>
                      <span className="upcoming-date-day">{badge.day}</span>
                    </div>
                    <div className="upcoming-body">
                      <div className="upcoming-title-row">
                        <b>{job.title}</b>
                        <span className={`pill status-${status.replace(/\s+/g, "-")}`}>{status}</span>
                      </div>
                      {(job.customer_name || job.address) && <div className="upcoming-sub">{job.customer_name || [job.address, job.city].filter(Boolean).join(", ")}</div>}
                      {job.address && <div className="upcoming-meta"><MapPin />{[job.address, job.city, job.zip].filter(Boolean).join(", ")}</div>}
                    </div>
                    <div className="upcoming-actions">
                      <a className="icon-btn" href={mapsSearchUrl(job)} target="_blank" rel="noreferrer" title="Open in Google Maps" aria-label="Open in Google Maps"><Navigation /></a>
                      <a className="icon-btn" href={googleCalendarCreateUrl(job, activeCompany?.name || "")} target="_blank" rel="noreferrer" title="Open in Google Calendar" aria-label="Open in Google Calendar"><CalendarIcon /></a>
                    </div>
                  </div>
                );
              })}
            </>
            : <div className="empty"><CalendarIcon />No scheduled jobs yet</div>}
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h3>This month</h3></div>
        <div className="card-b">
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-tile-icon" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}><CalendarIcon /></div>
              <div className="stat-tile-value">{scheduledCount}</div>
              <div className="stat-tile-label">Scheduled</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-icon" style={{ background: "var(--yellow-soft)", color: "var(--yellow)" }}><Clock /></div>
              <div className="stat-tile-value">{pendingCount}</div>
              <div className="stat-tile-label">Pending</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-icon" style={{ background: "var(--success-soft)", color: "var(--success)" }}><CheckCircle /></div>
              <div className="stat-tile-value">{completedCount}</div>
              <div className="stat-tile-label">Completed</div>
            </div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
