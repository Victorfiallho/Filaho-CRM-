import { useQueryClient } from "@tanstack/react-query";
import { Award, AlertTriangle, Clock, Inbox, MapPin, Plus, Settings, Target, Wallet } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import StagesEditor from "../components/StagesEditor";
import { updateLead } from "../data/leads";
import { useLeads, useStagnantLeads } from "../data/hooks";
import { filterRowsBySearch } from "../domain/search";
import { initials, money, relativeDate, unique } from "../domain/format";
import { isOpenStage, isWonStage } from "../domain/pipelineStages";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import type { Lead } from "../domain/types";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

// Drag-and-drop between stage columns — new functionality, not in app.js
// (the original only let you change a lead's stage via the edit modal's
// dropdown, which still works too). Native HTML5 DnD, no extra dependency.
//
// STAGE_RENDER_CAP is a stopgap against a stage column with hundreds/
// thousands of leads rendering every single card at once (slow, and each
// column scrolling forever). It's a render cap, not pagination — all leads
// still load and count correctly everywhere else (Dashboard, search); a
// column past the cap just points at the search bar to narrow down instead
// of listing everything. If real usage ever needs to *drag* deep into a
// capped column routinely, that's the signal to build real virtualization
// (react-window) or server-side paging instead of raising this number.
const STAGE_RENDER_CAP = 50;

export default function Pipeline() {
  const { activeCompanyId, stages } = useCompany();
  const { data: allLeads = [], isLoading } = useLeads(activeCompanyId);
  const { data: stagnantLeads = [] } = useStagnantLeads(activeCompanyId);
  const stagnantById = useMemo(() => new Map(stagnantLeads.map(s => [s.lead_id, s])), [stagnantLeads]);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const queryClient = useQueryClient();
  const leads = filterRowsBySearch(allLeads, searchText);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editingStages, setEditingStages] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");

  const sources = useMemo(() => unique(leads.map(l => l.source).filter(Boolean) as string[]), [leads]);
  const filteredLeads = sourceFilter === "all" ? leads : leads.filter(l => l.source === sourceFilter);

  // Matches whatever the board is actually showing (search + source filter)
  // instead of always totaling every lead regardless of the filter above —
  // a filtered-down board with KPIs still quoting the unfiltered company-wide
  // totals read as a bug (the numbers didn't move when the filter did).
  const openLeads = filteredLeads.filter(l => isOpenStage(l.stage_id, stages));
  const wonLeads = filteredLeads.filter(l => isWonStage(l.stage_id, stages));
  const pipelineValue = openLeads.reduce((t, l) => t + Number(l.value || 0), 0);
  const wonValue = wonLeads.reduce((t, l) => t + Number(l.value || 0), 0);

  const moveLead = async (leadId: string, stageId: string) => {
    if (!activeCompanyId) return;
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    // Optimistic update so the card jumps immediately instead of waiting on
    // the round-trip; rolled back if the save fails.
    queryClient.setQueryData<Lead[]>(["leads", activeCompanyId], prev =>
      prev?.map(l => (l.id === leadId ? { ...l, stage_id: stageId } : l))
    );
    try {
      await updateLead(leadId, activeCompanyId, { stage_id: stageId });
    } catch (error) {
      toast(errorMessage(error, "Could not move the lead."));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
    }
  };

  // Touch/pen counterpart to the native HTML5 DnD above — the native
  // `draggable` API has no touch support in most mobile browsers, which
  // left the whole "drag a lead to another stage" interaction dead on
  // tablet/phone (moving a lead was still possible via the edit modal's
  // stage dropdown, just not via the board). Pointer Events unify mouse/
  // touch/pen, so this only engages for non-mouse pointers (see LeadCard's
  // pointerType check below) — the existing mouse path is untouched.
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

  return (
    <div className="view-enter">
      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <KpiCard icon={Target} label="Open leads" value={openLeads.length} hint="across all open stages" />
        <KpiCard icon={Wallet} label="Pipeline value" value={money(pipelineValue)} hint="open leads" />
        <KpiCard icon={Award} label="Won leads" value={wonLeads.length} hint="closed pipeline" />
        <KpiCard icon={Award} label="Won value" value={money(wonValue)} hint="closed pipeline" />
      </div>
      <div className="between" style={{ marginBottom: 12 }}>
        <div className="inline-actions">
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <Select
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[{ value: "all", label: "All sources" }, ...sources.map(s => ({ value: s, label: s }))]}
            />
          </div>
          <span className="sub">{stages.length} stage{stages.length === 1 ? "" : "s"}</span>
        </div>
        <button className="btn ghost slim" onClick={() => setEditingStages(true)}><Settings />Edit stages</button>
      </div>
      <div className="pipeline">
      {stages.map(stage => {
        const stageLeads = filteredLeads.filter(l => l.stage_id === stage.id);
        return (
          <section
            className={`stage${dragOverStage === stage.id ? " drag-over" : ""}`}
            key={stage.id}
            data-stage-id={stage.id}
            style={{ borderTop: `3px solid ${stage.color || "var(--line-strong)"}` }}
            onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
            onDragLeave={() => setDragOverStage(prev => (prev === stage.id ? null : prev))}
            onDrop={e => {
              e.preventDefault();
              setDragOverStage(null);
              const leadId = e.dataTransfer.getData("text/plain") || draggingId;
              // Cleared here, not just in onDragEnd: the optimistic update
              // below re-renders the card into a different column right
              // away, which can unmount the original dragged DOM node before
              // the browser gets a chance to fire "dragend" on it — leaving
              // draggingId stuck and the card permanently faded.
              setDraggingId(null);
              if (leadId) moveLead(leadId, stage.id);
            }}
          >
            <div className="stage-h"><span>{stage.name}</span><span>{stageLeads.length}</span></div>
            <div className="stage-scroll">
              {stageLeads.length
                ? stageLeads.slice(0, STAGE_RENDER_CAP).map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    color={stage.color || "var(--muted)"}
                    stagnantDays={stagnantById.get(lead.id)?.days_in_stage}
                    dragging={draggingId === lead.id}
                    onClick={() => openRecordModal("lead", lead)}
                    onDragStart={e => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(lead.id); }}
                    onDragEnd={() => setDraggingId(null)}
                    onTouchDragStart={() => handleTouchDragStart(lead.id)}
                    onTouchDragOver={handleTouchDragOver}
                    onTouchDrop={handleTouchDrop}
                  />
                ))
                : (
                  <div className="empty">
                    <Inbox />
                    No leads yet
                    <span className="sub" style={{ margin: 0 }}>Leads added will appear here.</span>
                  </div>
                )}
              {stageLeads.length > STAGE_RENDER_CAP && (
                <div className="stage-more">
                  +{stageLeads.length - STAGE_RENDER_CAP} more — use search to narrow down
                </div>
              )}
            </div>
            <button className="stage-add-lead" onClick={() => openRecordModal("lead", undefined, { stage_id: stage.id })}>
              <Plus />Add lead
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

function LeadCard({ lead, color, stagnantDays, dragging, onClick, onDragStart, onDragEnd, onTouchDragStart, onTouchDragOver, onTouchDrop }: {
  lead: Lead; color: string; stagnantDays?: number; dragging: boolean; onClick: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onTouchDragStart: () => void;
  onTouchDragOver: (clientX: number, clientY: number) => void;
  onTouchDrop: (clientX: number, clientY: number) => void;
}) {
  const longPressTimer = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const touchDragActive = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  // Long-press-to-arm (not "any movement starts dragging", which is what the
  // native onDragStart below does for mouse) — a touch that moves right away
  // is almost always someone scrolling the column, not trying to pick up a
  // card. Holding still for TOUCH_LONG_PRESS_MS is the same disambiguation
  // technique most touch drag-and-drop libraries use, and it's what lets
  // preventDefault() on the subsequent pointermove actually suppress the
  // browser's own scroll instead of losing the race to it.
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
      else onTouchDrop(-1, -1); // out of viewport — resolves to "no stage", a clean cancel
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
      style={{ width: "calc(100% - 20px)", textAlign: "left", touchAction: dragging ? "none" : undefined }}
    >
      <div className="lead-card-head">
        <span className="lead-avatar" style={{ background: `color-mix(in srgb, ${color} 16%, white)`, color }}>{initials(lead.name)}</span>
        <div style={{ minWidth: 0 }}>
          <b>{lead.name}</b>
          <div className="sub">{lead.service_type || "Service"} · {money(lead.value)}</div>
        </div>
      </div>
      {(lead.city || lead.zip) && <div className="lead-card-meta"><MapPin />{[lead.city, lead.zip].filter(Boolean).join(" ")}</div>}
      {lead.updated_at && <div className="lead-card-meta"><Clock />Updated {relativeDate(lead.updated_at)}</div>}
      {stagnantDays !== undefined && (
        <div className="lead-card-meta stagnant-badge" title="No movement in this stage for a while">
          <AlertTriangle />{Math.floor(stagnantDays)}d stuck in stage
        </div>
      )}
    </button>
  );
}
