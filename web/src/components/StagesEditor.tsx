import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, GripVertical, Plus, Shield, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
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
const TYPE_DESCRIPTION: Record<StageType, string> = { open: "Active stage", won: "Completed deal", lost: "Lost deal" };

// Local draft + explicit Save, rather than saving each keystroke: reordering
// touches several rows at once, and stage `type` feeds Dashboard/Reports
// math directly (see domain/pipelineStages.ts), so a clear "did I actually
// save this" moment matters more here than it does for the simpler
// single-field settings elsewhere in the app.
export default function StagesEditor({ companyId, stages, onClose }: { companyId: string; stages: PipelineStage[]; onClose: () => void }) {
  const [draft, setDraft] = useState<DraftStage[]>(() => [...stages].sort((a, b) => a.order - b.order).map(s => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  function updateRow(id: string, patch: Partial<DraftStage>) {
    setDraft(d => d.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStage() {
    const existingIds = draft.map(s => s.id);
    const id = slugifyStageId("New stage", existingIds);
    const nextOrder = Math.max(0, ...draft.map(s => s.order)) + 1;
    setDraft(d => [...d, { id, company_id: companyId, name: "New stage", order: nextOrder, color: DEFAULT_COLOR, type: "open", win_probability: 0.5, isNew: true }]);
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

  // Drag-and-drop reordering, alongside the up/down buttons (buttons stay
  // for keyboard/no-mouse access) — reassigns clean sequential `order`
  // values for the whole list rather than swapping two, so repeated
  // reordering never accumulates gaps or duplicate order numbers.
  function reorderStage(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setDraft(d => {
      const sorted = [...d].sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex(s => s.id === draggedId);
      const toIdx = sorted.findIndex(s => s.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return d;
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      const orderById = new Map(sorted.map((s, i) => [s.id, i]));
      return d.map(s => ({ ...s, order: orderById.get(s.id) ?? s.order }));
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
          if (
            original.name !== row.name || original.color !== row.color || original.type !== row.type ||
            original.order !== row.order || original.win_probability !== row.win_probability
          ) {
            await updateStage(companyId, row.id, { name: row.name, color: row.color, type: row.type, order: row.order, win_probability: row.win_probability });
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

  // Portaled to #modal-root (sibling of #root, see index.html), same as
  // RecordModal — .content carries the page-enter animation's `transform`,
  // which makes it a containing block for any position:fixed descendant.
  // Rendered in place, this modal-bg would be confined to .content's box
  // instead of the viewport, clipping its own header off-screen.
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" style={{ width: "min(720px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h3>Customize your pipeline</h3>
            <span className="sub">Set up the steps your leads follow from first contact to a completed job.</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-b">
          <div className="stage-drag-hint"><GripVertical />Drag and drop to change the order.</div>
          <div className="stage-rows">
            {sorted.map((s, i) => {
              const type = (s.type || "open") as StageType;
              return (
                <div
                  className={`stage-row${draggingId === s.id ? " dragging" : ""}`}
                  key={s.id}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const draggedId = e.dataTransfer.getData("text/plain"); if (draggedId) reorderStage(draggedId, s.id); }}
                >
                  <button
                    className="stage-drag-handle"
                    draggable
                    onDragStart={e => { e.dataTransfer.setData("text/plain", s.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(s.id); }}
                    onDragEnd={() => setDraggingId(null)}
                    aria-label="Drag to reorder"
                  >
                    <GripVertical />
                  </button>
                  <div className="stage-row-order">
                    <button className="btn ghost slim" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp /></button>
                    <button className="btn ghost slim" onClick={() => move(s.id, 1)} disabled={i === sorted.length - 1} aria-label="Move down"><ChevronDown /></button>
                  </div>
                  <span className={`stage-badge type-${type}`}>
                    {type === "won" ? <Check /> : type === "lost" ? <X /> : i + 1}
                  </span>
                  <input
                    type="color"
                    value={s.color || DEFAULT_COLOR}
                    onChange={e => updateRow(s.id, { color: e.target.value })}
                    className="stage-color-input"
                    aria-label="Board color"
                    title="Board color (used on the kanban and dashboard)"
                  />
                  <div className="stage-row-main">
                    <input
                      value={s.name}
                      onChange={e => updateRow(s.id, { name: e.target.value })}
                      className="stage-name-input"
                      placeholder="Stage name"
                    />
                    <span className="sub">{TYPE_DESCRIPTION[type]}</span>
                  </div>
                  <div className={`stage-type type-${type}`}>
                    <Select
                      value={type}
                      onChange={v => updateRow(s.id, { type: v as StageType })}
                      options={STAGE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                    />
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round((s.win_probability ?? 0.5) * 100)}
                    onChange={e => updateRow(s.id, { win_probability: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
                    className="stage-win-prob-input"
                    aria-label="Win probability"
                    title="Win probability — used to weight this stage's leads in the funnel forecast"
                    style={{ width: 56 }}
                  />
                  <button className="icon-btn" onClick={() => removeStage(s.id)} aria-label="Remove stage" title="Remove stage"><Trash2 /></button>
                </div>
              );
            })}
          </div>
          <button className="btn ghost stage-add-btn" onClick={addStage}><Plus />Add another stage</button>
          <div className="stage-info-banner">
            <Shield />
            <div>
              <b>Open</b> stages count toward your pipeline. <b>Won</b> stages are counted as completed deals, <b>Lost</b> stages drop out of pipeline value.
              <div className="sub" style={{ marginTop: 2 }}>If you remove a stage that still has leads in it, you'll be asked to move them first.</div>
            </div>
          </div>
        </div>
        <div className="modal-f between">
          <span className="sub"><Shield />Changes apply to this company only.</span>
          <div className="inline-actions">
            <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </div>
      </section>
    </div>,
    document.getElementById("modal-root")!
  );
}
