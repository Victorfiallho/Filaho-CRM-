import { createContext, useContext, useState, type ReactNode } from "react";
import type { Customer, Job, Lead } from "../domain/types";

export type RecordType = "customer" | "lead" | "job";
export type AnyRecord = Customer | Lead | Job;

interface ModalState {
  type: RecordType;
  record?: AnyRecord;
  // Pre-fills a *new* record's fields (e.g. clicking a calendar day pre-fills
  // scheduled_date) without making the form think it's editing an existing row.
  initial?: Record<string, unknown>;
}

interface ModalContextValue {
  modal: ModalState | null;
  // Pass the already-loaded row to edit (no extra fetch — mirrors the
  // original app reading straight out of the in-memory `db` object), or
  // omit it to open a blank "new" form.
  openRecordModal: (type: RecordType, record?: AnyRecord, initial?: Record<string, unknown>) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  return (
    <ModalContext.Provider
      value={{
        modal,
        openRecordModal: (type, record, initial) => setModal({ type, record, initial }),
        closeModal: () => setModal(null)
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within ModalProvider");
  return ctx;
}
