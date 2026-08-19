import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Select from "./Select";
import { countLeadsInStage, deleteStage, insertStage, updateStage } from "../data/stages";
import { STAGE_TYPES, slugifyStageId, type StageType } from "../domain/pipelineStages";
import type { PipelineStage } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";

interface DraftStage extends PipelineStage {
  isNew?: boolean;
}

const DEFAULT_COLOR = "#667085";

// Local draft + explicit Save, rather than saving each keystroke: reordering
// touches several rows at once, and stage `type` feeds Dashboard/Reports
// math directly (see domain/pipelineStages.ts), so a clear "did I actually
// save this" moment matters more here than it does for the simpler
// single-field settings elsewhere in the app.
export default function StagesEditor({ companyId, stages, onClose }: { companyId: string; stages: PipelineStage[]; onClose: () => void }) {
  const [draft, setDraft] = useState<DraftStage[]>(() => [...stages].sort((a, b) => a.order - b.order).map(s => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  function updateRow(id: string, patch: Partial<DraftStage>) {
    setDraft(d => d.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStage() {
    const existingIds = draft.map(s => s.id);
    const id = slugifyStageId("New stage", existingIds);
    const nextOrder = Math.max(0, ...draft.map(s => s.order)) + 1;
    setDraft(d => [...d, { id, company_id: companyId, name: "New stage", order: nextOrder, color: DEFAULT_COLOR, type: "open", isNew: true }]);
  }

  function move(id: string, dir: -1 | 1) {
    setDraft(d => {
      const sorted = [...d].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(s => s.id === id);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return d;
      const a = sorted[idx], b = sorted[swapIdx];
      return d.map(s => (s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s));
    });
  }

  async function removeStage(id: string) {
    const row = draft.find(s => s.id === id);
    if (!row) return;
    if (!row.isNew) {
      const count = await countLeadsInStage(companyId, id).catch(() => 0);
      if (count > 0) {
        toast(`Move or update the ${count} lead${count === 1 ? "" : "s"} in this stage before deleting it.`);
        return;
      }
    }
    if (!window.confirm(`Delete stage "${row.name}"?`)) return;
    setDraft(d => d.filter(s => s.id !== id));
  }

  async function handleSave() {
    if (!draft.length) {
      toast("Keep at least one stage.");
      return;
    }
    setSaving(true);
    try {
      const originalIds = new Set(stages.map(s => s.id));
      const draftIds = new Set(draft.map(s => s.id));
      for (const orig of stages) {
        if (!draftIds.has(orig.id)) await deleteStage(companyId, orig.id);
      }
      for (const row of draft) {
        const { isNew, ...stage } = row;
        if (isNew || !originalIds.has(row.id)) {
          await insertStage(stage);
        } else {
          const original = stages.find(s => s.id === row.id)!;
          if (original.name !== row.name || original.color !== row.color || original.type !== row.type || original.order !== row.order) {
            await updateStage(companyId, row.id, { name: row.name, color: row.color, type: row.type, order: row.order });
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ["stages", companyId] });
      toast("Pipeline stages updated.");
      onClose();
    } catch (error) {
      toast(errorMessage(error, "Could not save pipeline stages."));
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...draft].sort((a, b) => a.order - b.order);

  return (
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" style={{ width: "min(640px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3>Edit pipeline stages</h3>
          <button className="btn ghost slim" onClick={onClose}>Close</button>
        </div>
        <div className="modal-b">
          <p className="sub" style={{ marginBottom: 14 }}>
            Type controls what counts where: <b>won</b> leads show up as closed deals on Dashboard/Reports,
            <b> lost</b> leads drop out of open pipeline value, everything else is treated as open.
          </p>
          <div className="stage-rows">
            {sorted.map((s, i) => (
              <div className="stage-row" key={s.id}>
                <div className="stage-row-order">
                  <button className="btn ghost slim" onClick={() => move(s.id, -1)} disabled={i === 0}>▲</button>
                  <button className="btn ghost slim" onClick={() => move(s.id, 1)} disabled={i === sorted.length - 1}>▼</button>
                </div>
                <input
                  type="color"
                  value={s.color || DEFAULT_COLOR}
                  onChange={e => updateRow(s.id, { color: e.target.value })}
                  className="stage-color-input"
                  aria-label="Stage color"
                />
                <input
                  value={s.name}
                  onChange={e => updateRow(s.id, { name: e.target.value })}
                  className="stage-name-input"
                  placeholder="Stage name"
                />
                <Select
                  value={s.type || "open"}
                  onChange={v => updateRow(s.id, { type: v as StageType })}
                  options={STAGE_TYPES.map(t => ({ value: t, label: t }))}
                />
                <button className="btn ghost slim" onClick={() => removeStage(s.id)}>Remove</button>
              </div>
            ))}
          </div>
          <button className="btn ghost slim" style={{ marginTop: 12 }} onClick={addStage}>Add stage</button>
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </section>
    </div>
  );
}
