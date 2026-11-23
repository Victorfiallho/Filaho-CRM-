// Keeps the open record (client, deal, job) in the URL as ?record=<type>:<id>,
// so a record has a link, Back closes it and a reload brings it back.
// RecordUrlSync runs the I/O; the decisions live here so they're testable.
import type { RecordType } from "../state/ModalContext";

export const RECORD_PARAM = "record";
const TYPES: RecordType[] = ["customer", "lead", "job"];

export function formatRecordParam(type: RecordType, id: string): string {
  return `${type}:${id}`;
}

export function parseRecordParam(value: string | null | undefined): { type: RecordType; id: string } | null {
  const m = /^(customer|lead|job):(.+)$/.exec(String(value || ""));
  if (!m || !TYPES.includes(m[1] as RecordType)) return null;
  return { type: m[1] as RecordType, id: m[2] };
}

export type SyncAction =
  | { kind: "none" }
  | { kind: "push"; value: string }      // a record opened: put it in the URL
  | { kind: "clearUrl" }                 // the person closed it: take it out
  | { kind: "closeModal" }               // the URL lost it (Back): close it
  | { kind: "openFromUrl"; value: string };

export interface SyncState {
  prevUrl: string | null;  // ?record= on the last run
  url: string | null;      // ?record= now
  prevOpen: string | null; // open record on the last run, as "<type>:<id>"
  open: string | null;     // open record now (null: none, or a new unsaved one)
  pending: string | null;  // a ?record= still waiting for its data to load
}

export function syncAction(s: SyncState): SyncAction {
  if (s.open !== s.prevOpen) {
    if (s.open && s.url !== s.open) return { kind: "push", value: s.open };
    if (!s.open && s.prevOpen && s.url === s.prevOpen) return { kind: "clearUrl" };
    return { kind: "none" };
  }
  if (s.url !== s.prevUrl) {
    if (s.url === s.open) return { kind: "none" };
    if (!s.url) return s.open ? { kind: "closeModal" } : { kind: "none" };
    return { kind: "openFromUrl", value: s.url };
  }
  if (s.pending && s.url === s.pending && s.url !== s.open) return { kind: "openFromUrl", value: s.pending };
  return { kind: "none" };
}
