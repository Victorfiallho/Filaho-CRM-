import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, MapPin, Plus, Settings, SlidersHorizontal, Users, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import StagesEditor from "../components/StagesEditor";
import { updateLead } from "../data/leads";
import { useConsentStatuses, useCurrentAppUser, useJobs, useLeads, useStagnantLeads, useUsers } from "../data/hooks";
import { dealTitle, otherDealCounts } from "../domain/deals";
import { filterRowsBySearch } from "../domain/search";
import { formatDay, initials, money, relativeDate, unique } from "../domain/format";
import { weeklyTrend } from "../domain/trend";
import { stageTone, type Tone } from "../domain/visual";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { followUpStatus, type FollowUpStatus } from "../domain/followUp";
import { localToday } from "../domain/jobFilters";
import { findJobForLead, jobDraftFromLead } from "../domain/leadConversion";
import { isLostStage, isOpenStage, isWonStage } from "../domain/pipelineStages";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import type { ConsentState, Lead } from "../domain/types";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

// Drag deals between stage columns (native HTML5 drag and drop; changing
// the stage in the deal form still works).
//
// STAGE_RENDER_CAP limits how many cards a column renders; every deal still
// loads and counts. Past the cap, the column points to search. If people
// need to drag deep into huge columns, that calls for virtualization or
// paging, not a bigger cap.
const STAGE_RENDER_CAP = 50;

export default function Pipeline() {
  const { activeCompanyId, stages } = useCompany();
  const { data: allLeads = [], isLoading } = useLeads(activeCompanyId);
  const { data: stagnantLeads = [] } = useStagnantLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: users = [] } = useUsers();
  const { data: currentAppUser } = useCurrentAppUser();
  const today = localToday();
  const stagnantById = useMemo(() => new Map(stagnantLeads.map(s => [s.lead_id, s])), [stagnantLeads]);
  // Other deals of the same client, over all deals (not just the filtered view).
  const otherDeals = useMemo(() => otherDealCounts(allLeads), [allLeads]);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const leads = filterRowsBySearch(allLeads, searchText);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editingStages, setEditingStages] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [smsFilter, setSmsFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  // Consent belongs to the client (consent_records.contact_id); a deal
  // without a client counts as not opted in.
  const { data: consentStatuses = [] } = useConsentStatuses(smsFilter !== "all" || emailFilter !== "all" ? activeCompanyId : null);
  const consentByCustomer = useMemo(() => new Map(consentStatuses.map(c => [c.contact_id, c])), [consentStatuses]);
  const consentOf = (l: Lead, channel: "sms" | "email"): ConsentState => {
    const c = l.customer_id ? consentByCustomer.get(l.customer_id) : undefined;
    return (channel === "sms" ? c?.sms_state : c?.email_state) || "not_opted_in";
  };

  const sources = useMemo(() => unique(leads.map(l => l.source).filter(Boolean) as string[]), [leads]);
  const filteredLeads = leads.filter(l => {
    if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
    if (stageFilter !== "all" && l.stage_id !== stageFilter) return false;
    if (smsFilter !== "all" && consentOf(l, "sms") !== smsFilter) return false;
    if (emailFilter !== "all" && consentOf(l, "email") !== emailFilter) return false;
    if (ownerFilter === "mine") return Boolean(currentAppUser) && l.owner_user_id === currentAppUser?.id;
    if (ownerFilter === "unassigned") return !l.owner_user_id;
    if (ownerFilter !== "all") return l.owner_user_id === ownerFilter;
    return true;
  });

  // KPIs follow the board's filters, so they move when the filter does.
  const openLeads = filteredLeads.filter(l => isOpenStage(l.stage_id, stages));
  const wonLeads = filteredLeads.filter(l => isWonStage(l.stage_id, stages));
  const pipelineValue = openLeads.reduce((t, l) => t + Number(l.value || 0), 0);
  const wonValue = wonLeads.reduce((t, l) => t + Number(l.value || 0), 0);

  const moveLead = async (leadId: string, stageId: string) => {
    if (!activeCompanyId) return;
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    // Optimistic: the card moves at once and moves back if the save fails.
    queryClient.setQueryData<Lead[]>(["leads", activeCompanyId], prev =>
      prev?.map(l => (l.id === leadId ? { ...l, stage_id: stageId } : l))
    );
    try {
      await updateLead(leadId, activeCompanyId, { stage_id: stageId });
      // Winning a deal is when the job should exist: open its prefilled form
      // (still cancelable) unless it already has one.
      if (isWonStage(stageId, stages) && !findJobForLead(leadId, jobs)) {
        toast(t("pipe.wonToast"));
        openRecordModal("job", undefined, { ...jobDraftFromLead(lead) });
      } else if (isLostStage(stageId, stages) && !lead.lost_reason) {
        // Ask why while it's fresh: the deal form shows the reason picker in a
        // lost stage.
        toast(t("pipe.lostToast"));
        openRecordModal("lead", { ...lead, stage_id: stageId });
      }
    } catch (error) {
      toastError(errorMessage(error, t("pipe.moveError")));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
    }
  };

  // Touch and pen dragging. Native `draggable` doesn't work on most mobile
  // browsers; these Pointer Events engage only for non-mouse pointers, so the
  // mouse path is unchanged.
  const handleTouchDragStart = (leadId: string) => setDraggingId(leadId);
  const stageIdAtPoint = (clientX: number, clientY: number): string | null =>
    (document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-stage-id]"))?.dataset.stageId || null;
  const handleTouchDragOver = (clientX: number, clientY: number) => setDragOverStage(stageIdAtPoint(clientX, clientY));
  const handleTouchDrop = (clientX: number, clientY: number) => {
    const stageId = stageIdAtPoint(clientX, clientY);
    const leadId = draggingId;
    setDraggingId(null);
    setDragOverStage(null);
    if (leadId && stageId) moveLead(leadId, stageId);
  };

  if (isLoading) return <PageSkeleton kpis={4} cards={0} />;

  const CONSENT_STATES: ConsentState[] = ["opted_in", "not_opted_in", "suppressed"];
  const activeFilters = [sourceFilter, ownerFilter, stageFilter, smsFilter, emailFilter].filter(v => v !== "all").length;
  const clearFilters = () => { setSourceFilter("all"); setOwnerFilter("all"); setStageFilter("all"); setSmsFilter("all"); setEmailFilter("all"); };
  const newLeadsWeekly = weeklyTrend(filteredLeads, l => l.created_at, () => 1, 10).map(p => p.value);
  const wonWeekly = weeklyTrend(wonLeads, l => l.updated_at, () => 1, 10).map(p => p.value);

  const filterControls = (
    <>
      <div className="pill-select">
        <Select value={sourceFilter} onChange={setSourceFilter} options={[{ value: "all", label: t("pipe.allSources") }, ...sources.map(s => ({ value: s, label: s }))]} />
      </div>
      <div className="pill-select">
        <Select
          value={ownerFilter}
          onChange={setOwnerFilter}
          options={[
            { value: "all", label: t("pipe.allOwners") },
            { value: "mine", label: t("pipe.myLeads") },
            { value: "unassigned", label: t("pipe.unassigned") },
            ...users.map(u => ({ value: u.id, label: u.name }))
          ]}
        />
      </div>
      <div className="pill-select">
        <Select value={stageFilter} onChange={setStageFilter} options={[{ value: "all", label: t("pipe.allStatuses") }, ...stages.map(s => ({ value: s.id, label: s.name }))]} />
      </div>
      <div className="pill-select">
        <Select
          value={smsFilter}
          onChange={setSmsFilter}
          options={[{ value: "all", label: t("pipe.smsAny") }, ...CONSENT_STATES.map(k => ({ value: k, label: t("pipe.sms", { state: t(`consent.${k}` as MessageKey) }) }))]}
        />
      </div>
      <div className="pill-select">
        <Select
          value={emailFilter}
          onChange={setEmailFilter}
          options={[{ value: "all", label: t("pipe.emailAny") }, ...CONSENT_STATES.map(k => ({ value: k, label: t("pipe.email", { state: t(`consent.${k}` as MessageKey) }) }))]}
        />
      </div>
      {activeFilters > 0 && (
        <button type="button" className="btn ghost slim" onClick={clearFilters}><X aria-hidden="true" />{t("pipe.clearFilters")}</button>
      )}
    </>
  );

  return (
    <div className="view-enter">
      <KpiStrip items={[
        { label: t("pipe.kpi.open"), value: openLeads.length, hint: t("pipe.kpi.openHint"), tone: "blue", series: newLeadsWeekly, seriesLabel: t("pipe.kpi.trend") },
        { label: t("pipe.kpi.value"), value: money(pipelineValue), hint: t("pipe.kpi.valueHint"), tone: "amber" },
        { label: t("pipe.kpi.won"), value: wonLeads.length, hint: t("pipe.kpi.wonHint"), tone: "green", series: wonWeekly, seriesLabel: t("pipe.kpi.wonHint") },
        { label: t("pipe.kpi.wonValue"), value: money(wonValue), hint: t("pipe.kpi.wonValueHint"), tone: "purple" }
      ]} />

      {/* Filters: one row of pills on desktop; behind a "Filters (n)" toggle on phones. */}
      <div className="filter-bar">
        <button
          type="button"
          className={`btn ghost slim filter-toggle${activeFilters ? " has-active" : ""}`}
          aria-expanded={filtersOpen}
          aria-controls="pipeline-filters"
          onClick={() => setFiltersOpen(v => !v)}
        >
          <SlidersHorizontal aria-hidden="true" />{activeFilters ? t("pipe.filtersCount", { count: activeFilters }) : t("pipe.filters")}
        </button>
        <div id="pipeline-filters" className={`filter-bar-controls${filtersOpen ? " open" : ""}`}>{filterControls}</div>
        <button className="btn ghost slim filter-bar-end" onClick={() => setEditingStages(true)}><Settings aria-hidden="true" />{t("pipe.editStages")}</button>
      </div>

      <div className="board" style={{ ["--board-cols" as any]: stages.length }}>
        {stages.map((stage, index) => {
          const stageLeads = filteredLeads.filter(l => l.stage_id === stage.id);
          const tone = stageTone(stage, index);
          return (
            <section
              className={`board-col tone-${tone}${dragOverStage === stage.id ? " drag-over" : ""}`}
              key={stage.id}
              data-stage-id={stage.id}
              aria-label={`${stage.name}, ${stageLeads.length}`}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage(prev => (prev === stage.id ? null : prev))}
              onDrop={e => {
                e.preventDefault();
                setDragOverStage(null);
                const leadId = e.dataTransfer.getData("text/plain") || draggingId;
                // Cleared here too: the optimistic move can unmount the dragged card before
                // the browser fires dragend, which would leave it faded.
                setDraggingId(null);
                if (leadId) moveLead(leadId, stage.id);
              }}
            >
              <header className="board-col-h">
                <span className="board-col-name">{stage.name}</span>
                <span className="board-col-count">{stageLeads.length}</span>
              </header>
              <div className="board-col-cards">
                {stageLeads.slice(0, STAGE_RENDER_CAP).map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    tone={tone}
                    stagnantDays={stagnantById.get(lead.id)?.days_in_stage}
                    otherDeals={otherDeals.get(lead.id) || 0}
                    followUp={followUpStatus(lead, stages, today)}
                    dragging={draggingId === lead.id}
                    onClick={() => openRecordModal("lead", lead)}
                    onDragStart={e => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(lead.id); }}
                    onDragEnd={() => setDraggingId(null)}
                    onTouchDragStart={() => handleTouchDragStart(lead.id)}
                    onTouchDragOver={handleTouchDragOver}
                    onTouchDrop={handleTouchDrop}
                  />
                ))}
                {stageLeads.length === 0 && <p className="board-col-empty">{t("pipe.noLeads")}</p>}
                {stageLeads.length > STAGE_RENDER_CAP && (
                  <p className="board-col-more">{t("pipe.more", { count: stageLeads.length - STAGE_RENDER_CAP })}</p>
                )}
              </div>
              <button className="board-col-add" onClick={() => openRecordModal("lead", undefined, { stage_id: stage.id })}>
                <Plus aria-hidden="true" />{t("pipe.addLead")}
              </button>
            </section>
          );
        })}
      </div>
      {editingStages && activeCompanyId && (
        <StagesEditor companyId={activeCompanyId} stages={stages} onClose={() => setEditingStages(false)} />
      )}
    </div>
  );
}

const TOUCH_LONG_PRESS_MS = 260;
const TOUCH_CANCEL_THRESHOLD_PX = 10;

function LeadCard({ lead, tone, stagnantDays, otherDeals, followUp, dragging, onClick, onDragStart, onDragEnd, onTouchDragStart, onTouchDragOver, onTouchDrop }: {
  lead: Lead; tone: Tone; stagnantDays?: number; otherDeals: number; followUp: FollowUpStatus | null; dragging: boolean; onClick: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onTouchDragStart: () => void;
  onTouchDragOver: (clientX: number, clientY: number) => void;
  onTouchDrop: (clientX: number, clientY: number) => void;
}) {
  const { t, tn, locale } = useT();
  const longPressTimer = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const touchDragActive = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  // Long-press to start a touch drag: a touch that moves right away is a
  // scroll. Holding still for TOUCH_LONG_PRESS_MS lets preventDefault() on
  // the next pointermove win against the browser's scroll.
  function handlePointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    touchDragActive.current = false;
    const pointerId = e.pointerId;
    const target = e.currentTarget;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      touchDragActive.current = true;
      onTouchDragStart();
      try { target.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
    }, TOUCH_LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.pointerType === "mouse" || !pointerStart.current) return;
    if (!touchDragActive.current) {
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      if (Math.hypot(dx, dy) > TOUCH_CANCEL_THRESHOLD_PX) clearLongPress();
      return;
    }
    e.preventDefault();
    onTouchDragOver(e.clientX, e.clientY);
  }

  function endTouchSequence(e: React.PointerEvent, commit: boolean) {
    if (e.pointerType === "mouse") return;
    clearLongPress();
    if (touchDragActive.current) {
      if (commit) onTouchDrop(e.clientX, e.clientY);
      else onTouchDrop(-1, -1); // outside the screen: no stage, so the drag is cancelled
    }
    touchDragActive.current = false;
    pointerStart.current = null;
  }

  return (
    <button
      className={`lead-card${dragging ? " dragging" : ""}`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={e => endTouchSequence(e, true)}
      onPointerCancel={e => endTouchSequence(e, false)}
      style={{ touchAction: dragging ? "none" : undefined }}
    >
      <div className="lead-card-head">
        <span className={`lead-avatar tone-${tone}`} aria-hidden="true">{initials(lead.name)}</span>
        <b className="lead-card-name">{dealTitle(lead) || lead.name}</b>
      </div>
      <div className="lead-card-service">{dealTitle(lead) ? [lead.name, lead.title?.trim() ? lead.service_type : ""].filter(Boolean).join(" · ") : t("pipe.service")}</div>
      <div className="lead-card-chips">
        {Number(lead.value) > 0 && <span className="chip chip-value">{money(lead.value)}</span>}
        {(lead.city || lead.zip) && <span className="chip"><MapPin aria-hidden="true" />{lead.city || lead.zip}</span>}
        {otherDeals > 0 && <span className="chip chip-others" title={t("deal.othersTitle")}><Users aria-hidden="true" />{tn("deal.others", otherDeals)}</span>}
      </div>
      {followUp && (
        <div className={`lead-card-meta follow-up-${followUp}`}>
          <CalendarClock aria-hidden="true" />
          <span>{followUp === "overdue" ? t("pipe.overdue") : followUp === "today" ? t("pipe.today") : formatDay(lead.next_action_date, undefined, locale)}: {lead.next_action || t("dash.followUp")}</span>
        </div>
      )}
      <div className="lead-card-foot">
        {lead.updated_at && <span className="lead-card-meta"><Clock aria-hidden="true" />{t("pipe.updated", { date: relativeDate(lead.updated_at, new Date(), locale) })}</span>}
        {stagnantDays !== undefined && (
          <span className="badge-tone tone-amber" title={t("pipe.stuckTitle")}>
            <AlertTriangle aria-hidden="true" />{t("pipe.stuck", { days: Math.floor(stagnantDays) })}
          </span>
        )}
      </div>
    </button>
  );
}
