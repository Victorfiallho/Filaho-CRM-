import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, MapPin, Navigation, Plus, User } from "lucide-react";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import { buildCompanyIcsCalendar, googleCalendarCreateUrl } from "../domain/calendarExport";
import { useCustomers, useJobs } from "../data/hooks";
import { localToday, upcomingJobs } from "../domain/jobFilters";
import { TONES, type Tone } from "../domain/visual";
import type { Job } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { downloadText } from "../lib/downloadText";
import { toast } from "../lib/toast";
import { useCalendar } from "../state/CalendarContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

const UPCOMING_SHOWN = 10;

// Same service, same tone, so jobs of a kind group visually (by job id when
// there's no service).
function toneFor(job: Job): Tone {
  const key = job.service_type || job.id;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const palette = TONES.filter(t => t !== "slate");
  return palette[hash % palette.length];
}

function mapsSearchUrl(job: Job) {
  const query = [job.address, job.city, job.state, job.zip].filter(Boolean).join(", ") || job.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Month grid and upcoming list side by side, month totals in the KPI strip.
export default function Calendar() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { t, tn, locale } = useT();
  const { data: jobs = [], isLoading } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { calendarDate, setCalendarDate } = useCalendar();
  const { openRecordModal } = useModal();

  if (isLoading) return <PageSkeleton kpis={3} cards={2} />;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const monthJobs = jobs.filter(job => job.scheduled_date?.startsWith(monthPrefix));
  // Local date: toISOString() is UTC and flips to tomorrow every evening in
  // US time zones.
  const today = localToday();
  // Capitalize only the first letter ("Outubro de 2026", not "Outubro De 2026").
  const monthLabel = calendarDate.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const monthName = monthLabel.charAt(0).toLocaleUpperCase(locale) + monthLabel.slice(1);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + i).toLocaleDateString(locale, { weekday: "short" }));
  const clientName = new Map(customers.map(c => [c.id, c.name]));

  const cells = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, date: `${monthPrefix}${String(i + 1).padStart(2, "0")}` }));
  const moveCalendar = (delta: number) => setCalendarDate(new Date(year, month + delta, 1));
  const openQuickJob = (date: string) => openRecordModal("job", undefined, { scheduled_date: date });

  const downloadCompanyIcs = () => {
    const scheduled = jobs.filter(j => j.scheduled_date);
    if (!scheduled.length) { toast(t("cal.noExport")); return; }
    downloadText(`${activeCompany?.slug}-jobs.ics`, buildCompanyIcsCalendar(activeCompany?.name || "", scheduled), "text/calendar");
  };

  // Upcoming: from today on, not complete (same rule as the Dashboard).
  const upcoming = upcomingJobs(jobs, today, UPCOMING_SHOWN);
  const pendingCount = monthJobs.filter(j => (j.status || "planned") === "planned").length;
  const completedCount = monthJobs.filter(j => j.status === "complete").length;
  const statusLabel = (s: string) => t(`status.${s}` as MessageKey);

  return (
    <>
      <KpiStrip items={[
        { label: t("cal.kpi.scheduled"), value: monthJobs.length, hint: t("cal.kpi.scheduledHint", { month: monthLabel }), tone: "blue" },
        { label: t("cal.kpi.pending"), value: pendingCount, hint: t("cal.kpi.pendingHint"), tone: "amber" },
        { label: t("cal.kpi.completed"), value: completedCount, hint: t("cal.kpi.completedHint"), tone: "green" }
      ]} />

      <div className="calendar-layout">
        <section className="card">
          <div className="card-h calendar-head">
            <h3 className="calendar-month">{monthName}</h3>
            <div className="calendar-nav">
              <button className="round-btn" onClick={() => moveCalendar(-1)} aria-label={t("cal.prev")}><ChevronLeft aria-hidden="true" /></button>
              <button className="btn ghost slim" onClick={() => setCalendarDate(new Date())}>{t("cal.today")}</button>
              <button className="round-btn" onClick={() => moveCalendar(1)} aria-label={t("cal.next")}><ChevronRight aria-hidden="true" /></button>
              <button className="btn ghost slim" onClick={downloadCompanyIcs}><Download aria-hidden="true" />{t("cal.export")}</button>
            </div>
          </div>
          <div className="card-b">
            <div className="calendar-grid" role="grid" aria-label={monthName}>
              {weekdays.map(d => <div className="cal-head" role="columnheader" key={d}>{d}</div>)}
              {Array.from({ length: startPad }).map((_, i) => <div className="cal-cell pad" key={`pad${i}`} aria-hidden="true" />)}
              {cells.map(({ day, date }) => {
                const dayJobs = monthJobs.filter(job => job.scheduled_date === date);
                return (
                  <div
                    key={date}
                    className={`cal-cell${date === today ? " today" : ""}${date < today ? " past" : ""}`}
                    role="gridcell"
                    tabIndex={0}
                    onClick={() => openQuickJob(date)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openQuickJob(date); } }}
                    aria-label={dayJobs.length ? tn("cal.dayJobs", dayJobs.length, { day }) : t("cal.dayAdd", { day })}
                  >
                    <span className="cal-day">{day}</span>
                    {dayJobs.slice(0, 3).map(job => (
                      <button
                        type="button"
                        className={`cal-job tone-${toneFor(job)}`}
                        key={job.id}
                        onClick={e => { e.stopPropagation(); openRecordModal("job", job); }}
                        title={job.title}
                      >
                        {job.title}
                      </button>
                    ))}
                    {dayJobs.length > 3 && <span className="cal-more">{t("cal.more", { count: dayJobs.length - 3 })}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card self-start">
          <div className="card-h">
            <div><h3>{t("cal.upcoming")}</h3><span className="sub">{t("cal.upcomingSub")}</span></div>
            <button className="btn slim" onClick={() => openRecordModal("job")}><Plus aria-hidden="true" />{t("cal.addJob")}</button>
          </div>
          <div className="card-b">
            {upcoming.length ? (
              <ul className="upcoming-list">
                {upcoming.map(job => {
                  const d = new Date(`${job.scheduled_date}T00:00:00`);
                  const status = job.status || "planned";
                  const client = job.customer_name || clientName.get(job.customer_id || "") || "";
                  const place = [job.address, job.city].filter(Boolean).join(", ");
                  return (
                    <li className="upcoming-item" key={job.id}>
                      <button type="button" className={`upcoming-date tone-${toneFor(job)}`} onClick={() => openRecordModal("job", job)} aria-label={`${job.title}, ${d.toLocaleDateString(locale, { day: "numeric", month: "long" })}`}>
                        <span>{d.toLocaleDateString(locale, { month: "short" }).replace(".", "")}</span>
                        <b>{d.getDate()}</b>
                      </button>
                      <div className="upcoming-body">
                        <div className="upcoming-title-row">
                          <b>{job.title}</b>
                          <span className={`pill status-${status.replace(/\s+/g, "-")}`}>{statusLabel(status)}</span>
                        </div>
                        {client && <div className="upcoming-meta"><User aria-hidden="true" />{client}</div>}
                        {place && <div className="upcoming-meta"><MapPin aria-hidden="true" />{place}</div>}
                      </div>
                      <div className="upcoming-actions">
                        <a className="round-btn" href={mapsSearchUrl(job)} target="_blank" rel="noreferrer" title={t("cal.openMaps")} aria-label={t("cal.openMaps")}><Navigation aria-hidden="true" /></a>
                        <a className="round-btn" href={googleCalendarCreateUrl(job, activeCompany?.name || "")} target="_blank" rel="noreferrer" title={t("cal.openCalendar")} aria-label={t("cal.openCalendar")}><CalendarIcon aria-hidden="true" /></a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState icon={CalendarIcon}>{t("cal.noUpcoming")}</EmptyState>}
          </div>
        </section>
      </div>
    </>
  );
}
