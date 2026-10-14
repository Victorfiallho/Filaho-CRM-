import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, GripVertical, Info, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import Select from "./Select";
import { countLeadsInStage, deleteStage, insertStage, updateStage } from "../data/stages";
import { STAGE_TYPES, slugifyStageId, type StageType } from "../domain/pipelineStages";
import type { PipelineStage } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useT } from "../i18n/I18nContext";
import { useConfirm } from "../state/ConfirmContext";

interface DraftStage extends PipelineStage {
  isNew?: boolean;
}

const DEFAULT_COLOR = "#667085";

// A local draft saved together: reordering touches several rows, and the
// stage `type` drives Dashboard and Reports math.
export default function StagesEditor({ companyId, stages, onClose }: { companyId: string; stages: PipelineStage[]; onClose: () => void }) {
  const { t, tn } = useT();
  const { confirm } = useConfirm();
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
    setDraft(d => [...d, { id, company_id: companyId, name: t("stg.newStage"), order: nextOrder, color: DEFAULT_COLOR, type: "open", win_probability: 0.5, isNew: true }]);
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

  // Drag-and-drop next to the up/down buttons (kept for the keyboard).
  // Renumbers the whole list, so `order` never gets gaps or duplicates.
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
        toast(tn("stg.hasLeads", count));
        return;
      }
    }
    if (!(await confirm({ message: t("confirm.deleteStage", { name: row.name }), danger: true }))) return;
    setDraft(d => d.filter(s => s.id !== id));
  }

  async function handleSave() {
    if (!draft.length) {
      toast(t("stg.keepOne"));
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
      toast(t("stg.saved"));
      onClose();
    } catch (error) {
      toastError(errorMessage(error, t("stg.saveError")));
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...draft].sort((a, b) => a.order - b.order);

  // Portaled to #modal-root like RecordModal: .content has a transform from
  // its page animation, which would trap a position:fixed backdrop inside it.
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="stages-title" style={{ width: "min(760px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h3 id="stages-title">{t("stg.title")}</h3>
            <span className="sub">{t("stg.subtitle")}</span>
          </div>
          <button className="round-btn" onClick={onClose} aria-label={t("stg.close")}><X aria-hidden="true" /></button>
        </div>
        <div className="modal-b">
          <div className="stage-drag-hint"><GripVertical aria-hidden="true" />{t("stg.dragHint")}</div>
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
                  <div className="stage-row-lead">
                    <button
                      type="button"
                      className="stage-drag-handle"
                      draggable
                      onDragStart={e => { e.dataTransfer.setData("text/plain", s.id); e.dataTransfer.effectAllowed = "move"; setDraggingId(s.id); }}
                      onDragEnd={() => setDraggingId(null)}
                      aria-label={t("stg.dragHandle")}
                    >
                      <GripVertical aria-hidden="true" />
                    </button>
                    <span className={`stage-badge type-${type}`} aria-hidden="true">
                      {type === "won" ? <Check /> : type === "lost" ? <X /> : i + 1}
                    </span>
                    <input
                      type="color"
                      value={s.color || DEFAULT_COLOR}
                      onChange={e => updateRow(s.id, { color: e.target.value })}
                      className="stage-color-input"
                      aria-label={t("stg.color")}
                      title={t("stg.color")}
                    />
                    <div className="stage-row-main">
                      <input
                        value={s.name}
                        onChange={e => updateRow(s.id, { name: e.target.value })}
                        className="stage-name-input"
                        placeholder={t("stg.name")}
                        aria-label={t("stg.name")}
                      />
                      <span className="sub">{t(`stg.desc.${type}`)}</span>
                    </div>
                  </div>
                  <div className="stage-row-controls">
                    <div className={`stage-type type-${type}`}>
                      <Select
                        value={type}
                        aria-label={t("stg.type")}
                        onChange={v => updateRow(s.id, { type: v as StageType })}
                        options={STAGE_TYPES.map(st => ({ value: st, label: t(`stg.type.${st}`) }))}
                      />
                    </div>
                    <label className="stage-prob" title={t("stg.winProbHint")}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={Math.round((s.win_probability ?? 0.5) * 100)}
                        onChange={e => updateRow(s.id, { win_probability: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
                        aria-label={t("stg.winProb")}
                      />
                      <span aria-hidden="true">%</span>
                    </label>
                    <span className="stage-row-spacer" />
                    <button type="button" className="round-btn" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label={t("stg.moveUp")}><ArrowUp aria-hidden="true" /></button>
                    <button type="button" className="round-btn" onClick={() => move(s.id, 1)} disabled={i === sorted.length - 1} aria-label={t("stg.moveDown")}><ArrowDown aria-hidden="true" /></button>
                    <button type="button" className="round-btn danger" onClick={() => removeStage(s.id)} aria-label={t("stg.remove")} title={t("stg.remove")}><Trash2 aria-hidden="true" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn ghost stage-add-btn" onClick={addStage}><Plus aria-hidden="true" />{t("stg.add")}</button>
          <div className="stage-info-banner">
            <Info aria-hidden="true" />
            <div>
              {t("stg.info")}
              <div className="sub" style={{ marginTop: 2 }}>{t("stg.infoSub")}</div>
            </div>
          </div>
        </div>
        <div className="modal-f between">
          <span className="sub">{t("stg.scope")}</span>
          <div className="inline-actions">
            <button className="btn ghost" onClick={onClose} disabled={saving}>{t("stg.cancel")}</button>
            <button className="btn" onClick={handleSave} disabled={saving}>{saving ? t("stg.saving") : t("stg.save")}</button>
          </div>
        </div>
      </section>
    </div>,
    document.getElementById("modal-root")!
  );
}
