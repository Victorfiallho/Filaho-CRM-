import { useQueryClient } from "@tanstack/react-query";
import { Award, Clock, Inbox, MapPin, Plus, Settings, Target, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import KpiCard from "../components/KpiCard";
import Select from "../components/Select";
import StagesEditor from "../components/StagesEditor";
import { updateLead } from "../data/leads";
import { useLeads } from "../data/hooks";
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
  const { data: allLeads = [] } = useLeads(activeCompanyId);
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

  const openLeads = allLeads.filter(l => isOpenStage(l.stage_id, stages));
  const wonLeads = allLeads.filter(l => isWonStage(l.stage_id, stages));
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

  return (
    <>
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
                    dragging={draggingId === lead.id}
                    onClick={() => openRecordModal("lead", lead)}
                    onDragStart={e => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(lead.id); }}
                    onDragEnd={() => setDraggingId(null)}
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
    </>
  );
}

function LeadCard({ lead, color, dragging, onClick, onDragStart, onDragEnd }: {
  lead: Lead; color: string; dragging: boolean; onClick: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
}) {
  return (
    <button
      className={`lead-card${dragging ? " dragging" : ""}`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ width: "calc(100% - 20px)", textAlign: "left" }}
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
    </button>
  );
}
