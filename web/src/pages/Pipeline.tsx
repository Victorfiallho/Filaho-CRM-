import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import StagesEditor from "../components/StagesEditor";
import { updateLead } from "../data/leads";
import { useLeads } from "../data/hooks";
import { filterRowsBySearch } from "../domain/search";
import { money } from "../domain/format";
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
      <div className="between" style={{ marginBottom: 12 }}>
        <span className="sub">{stages.length} stage{stages.length === 1 ? "" : "s"}</span>
        <button className="btn ghost slim" onClick={() => setEditingStages(true)}>Edit stages</button>
      </div>
      <div className="pipeline">
      {stages.map(stage => {
        const stageLeads = leads.filter(l => l.stage_id === stage.id);
        return (
          <section
            className={`stage${dragOverStage === stage.id ? " drag-over" : ""}`}
            key={stage.id}
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
                    dragging={draggingId === lead.id}
                    onClick={() => openRecordModal("lead", lead)}
                    onDragStart={e => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(lead.id); }}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))
                : <div className="empty">No leads</div>}
              {stageLeads.length > STAGE_RENDER_CAP && (
                <div className="sub" style={{ margin: "0 10px 10px", textAlign: "center" }}>
                  +{stageLeads.length - STAGE_RENDER_CAP} more — use search to narrow down
                </div>
              )}
            </div>
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

function LeadCard({ lead, dragging, onClick, onDragStart, onDragEnd }: {
  lead: Lead; dragging: boolean; onClick: () => void;
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
      <b>{lead.name}</b>
      <div className="sub">{lead.service_type || "Service"} | {money(lead.value)}</div>
      <div className="sub">{[lead.city, lead.zip].filter(Boolean).join(" ")}</div>
    </button>
  );
}
