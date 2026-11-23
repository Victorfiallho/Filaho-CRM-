import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useCustomers, useJobs, useLeads } from "../data/hooks";
import { RECORD_PARAM, formatRecordParam, parseRecordParam, syncAction } from "../lib/recordUrl";
import { useCompany } from "../state/CompanyContext";
import { useModal, type AnyRecord } from "../state/ModalContext";

// Ties the record form (RecordModal) to ?record=<type>:<id>. Rules in
// lib/recordUrl.ts. Renders nothing.
export default function RecordUrlSync() {
  const { modal, openRecordModal, closeModal } = useModal();
  const { activeCompanyId } = useCompany();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const customers = useCustomers(activeCompanyId).data;
  const leads = useLeads(activeCompanyId).data;
  const jobs = useJobs(activeCompanyId).data;

  const url = params.get(RECORD_PARAM);
  const open = modal?.record?.id ? formatRecordParam(modal.type, modal.record.id) : null;
  const prev = useRef({ url, open });
  const pending = useRef<string | null>(url && url !== open ? url : null);
  // The history entry we added when a record opened: closing it goes Back
  // to the entry before, instead of stacking a second copy of the page.
  const pushedKey = useRef<string | null>(null);
  const awaitingPush = useRef<string | null>(null);

  if (awaitingPush.current && url === awaitingPush.current) {
    pushedKey.current = location.key;
    awaitingPush.current = null;
  }

  const withParam = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(RECORD_PARAM, value); else next.delete(RECORD_PARAM);
    const search = next.toString();
    return { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash };
  };

  useEffect(() => {
    const action = syncAction({ prevUrl: prev.current.url, url, prevOpen: prev.current.open, open, pending: pending.current });
    prev.current = { url, open };

    if (action.kind === "push") {
      awaitingPush.current = action.value;
      navigate(withParam(action.value), { state: location.state });
    } else if (action.kind === "clearUrl") {
      if (pushedKey.current && pushedKey.current === location.key) navigate(-1);
      else navigate(withParam(null), { replace: true });
      pushedKey.current = null;
    } else if (action.kind === "closeModal") {
      pushedKey.current = null;
      closeModal();
    } else if (action.kind === "openFromUrl") {
      const ref = parseRecordParam(action.value);
      const list: AnyRecord[] | undefined = !ref ? [] : ref.type === "customer" ? customers : ref.type === "lead" ? leads : jobs;
      if (!list) { pending.current = action.value; return; } // still loading
      pending.current = null;
      const record = ref ? list.find(r => r.id === ref.id) : undefined;
      if (record && ref) openRecordModal(ref.type, record);
      else navigate(withParam(null), { replace: true }); // not in this company, or deleted
    }
    // withParam reads params/location from this render, which the deps cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, open, customers, leads, jobs]);

  return null;
}
