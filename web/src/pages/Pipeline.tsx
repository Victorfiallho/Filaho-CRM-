import { useLeads } from "../data/hooks";
import { filterRowsBySearch } from "../domain/search";
import { money } from "../domain/format";
import type { Lead } from "../domain/types";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

export default function Pipeline() {
  const { activeCompanyId, stages } = useCompany();
  const { data: allLeads = [] } = useLeads(activeCompanyId);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const leads = filterRowsBySearch(allLeads, searchText);

  return (
    <div className="pipeline">
      {stages.map(stage => {
        const stageLeads = leads.filter(l => l.stage_id === stage.id);
        return (
          <section className="stage" key={stage.id}>
            <div className="stage-h"><span>{stage.name}</span><span>{stageLeads.length}</span></div>
            {stageLeads.length
              ? stageLeads.map(lead => <LeadCard key={lead.id} lead={lead} onClick={() => openRecordModal("lead", lead)} />)
              : <div className="empty">No leads</div>}
          </section>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <button className="lead-card" onClick={onClick} style={{ width: "calc(100% - 20px)", textAlign: "left" }}>
      <b>{lead.name}</b>
      <div className="sub">{lead.service_type || "Service"} | {money(lead.value)}</div>
      <div className="sub">{[lead.city, lead.zip].filter(Boolean).join(" ")}</div>
    </button>
  );
}
