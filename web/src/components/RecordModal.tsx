import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Select from "./Select";
import { listCustomers, insertCustomer, updateCustomer } from "../data/customers";
import { insertJob, updateJob } from "../data/jobs";
import { upsertClientFromLead } from "../data/leadClientSync";
import { insertLead, updateLead } from "../data/leads";
import { now, uid } from "../domain/format";
import { titleize } from "../domain/format";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

// Ported from app.js (recordForm/readForm/saveRecord). Same field lists, same
// order, same "Name or title is required" validation, same lead->client sync
// rule on create/edit. Mechanical change: one controlled form per open modal
// instead of reading raw `<input>` values off the DOM by id.
export default function RecordModal() {
  const { modal } = useModal();
  if (!modal) return null;
  return createPortal(<RecordModalContent key={modal.record?.id || modal.type} />, document.getElementById("modal-root")!);
}

function RecordModalContent() {
  // `modal` is guaranteed non-null here (the RecordModal wrapper only mounts this
  // component while it's set), but every hook below still has to run unconditionally
  // on every render — so the "no modal / no company" bail-out is a plain variable,
  // not an early return, and the actual `return null` happens after all hooks.
  const { modal, closeModal } = useModal();
  const { activeCompanyId, services, stages } = useCompany();
  const queryClient = useQueryClient();
  const type = modal?.type ?? "customer";
  const record = modal?.record;
  const r = { ...(modal?.initial || {}), ...(record || {}) } as any;
  const isEdit = Boolean(record);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", activeCompanyId],
    queryFn: () => listCustomers(activeCompanyId!),
    enabled: (type === "job" || type === "lead") && Boolean(activeCompanyId)
  });

  // Lets a new lead be linked to an existing client by picking them from a
  // list, instead of only relying on the fuzzy dedupe match (phone/email/
  // address/name+ZIP) to find them after the fact. When set, this is passed
  // through to upsertClientFromLead as the same `preferredClientId` an edit
  // already uses, so it links by id directly rather than guessing.
  const [pickedClientId, setPickedClientId] = useState("");

  const [form, setForm] = useState(() => ({
    title: r.title || "",
    customer_id: r.customer_id || (type === "job" ? "" : undefined),
    status: r.status || (type === "job" ? "planned" : "active"),
    name: r.name || "",
    phone: r.phone || "",
    email: r.email || "",
    service_type: r.service_type || services[0] || "",
    stage_id: r.stage_id || "new",
    value: r.value ?? "",
    source: r.source || "Manual",
    scheduled_date: r.scheduled_date || "",
    estimated_value: r.estimated_value ?? "",
    address: r.address || "",
    city: r.city || "",
    state: r.state || "",
    zip: r.zip || "",
    drive_folder_url: r.drive_folder_url || "",
    lat: r.lat ?? "",
    lng: r.lng ?? "",
    notes: r.notes || ""
  }));
  const [saving, setSaving] = useState(false);

  // The custom Select shows nothing selected when `value` matches no option,
  // instead of a native <select>'s browser-default "first option" look — so
  // for a new job, once customers load, pre-select the first one to keep the
  // same visual (and saved) outcome as before if the user never touches it.
  useEffect(() => {
    if (type === "job" && !isEdit && !form.customer_id && customers.length) {
      setForm(f => ({ ...f, customer_id: customers[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, isEdit, customers]);

  if (!modal || !activeCompanyId) return null;

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const pickExistingClient = (clientId: string) => {
    setPickedClientId(clientId);
    if (!clientId) return;
    const client = customers.find(c => c.id === clientId);
    if (!client) return;
    setForm(f => ({
      ...f,
      name: client.name || f.name,
      phone: client.phone || f.phone,
      email: client.email || f.email,
      service_type: client.service_type || f.service_type,
      address: client.address || f.address,
      city: client.city || f.city,
      state: client.state || f.state,
      zip: client.zip || f.zip
    }));
  };

  const titleType = type === "customer" ? "client" : type;
  const title = `${isEdit ? "Edit" : "New"} ${titleType}`;

  async function handleSave() {
    if (!activeCompanyId) return;
    if (!form.name && !form.title) {
      toast("Name or title is required.");
      return;
    }
    setSaving(true);
    try {
      if (type === "job") {
        const data = {
          company_id: activeCompanyId,
          title: form.title,
          // The <select> has no blank option (matches app.js's recordForm), so a
          // browser leaves the first customer visually selected when nothing was
          // explicitly chosen — mirror that by falling back to the first customer
          // on save too, instead of silently saving an unassigned job.
          customer_id: form.customer_id || customers[0]?.id || "",
          status: form.status || "planned",
          service_type: form.service_type,
          scheduled_date: form.scheduled_date,
          estimated_value: Number(form.estimated_value || 0),
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
          drive_folder_url: form.drive_folder_url,
          lat: Number(form.lat || 0) || "",
          lng: Number(form.lng || 0) || ""
        };
        if (isEdit && r.id) await updateJob(r.id, activeCompanyId, data as any);
        else await insertJob({ ...(data as any), id: uid("job"), created_at: now() });
        queryClient.invalidateQueries({ queryKey: ["jobs", activeCompanyId] });
      } else {
        // `notes` and `drive_folder_url` only exist on the `customers` table —
        // app.js's original readForm() always included them for leads too
        // (harmless when everything lived in one localStorage blob), but a
        // real `leads` table with no such columns rejects the insert/update.
        const data: Record<string, any> = {
          company_id: activeCompanyId,
          name: form.name,
          phone: form.phone,
          email: form.email,
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
          service_type: form.service_type,
          lat: Number(form.lat || 0) || "",
          lng: Number(form.lng || 0) || ""
        };
        if (type === "lead") {
          data.stage_id = form.stage_id;
          data.value = Number(form.value || 0);
          data.source = "Manual";
        }
        if (type === "customer") {
          data.status = form.status;
          data.source = form.source;
          data.notes = form.notes;
          data.drive_folder_url = form.drive_folder_url;
        }

        if (isEdit && r.id) {
          if (type === "lead") {
            // The client-sync uses cleanCustomer(), which writes to the
            // `customers` table (which does have notes/drive_folder_url) —
            // so the lead form's Notes text still carries over to the linked
            // client, same as app.js, even though it's stripped from `data`
            // before that's sent to the (notes-less) `leads` table below.
            const client = await upsertClientFromLead({ ...data, notes: form.notes }, activeCompanyId, services[0] || "", r.customer_id);
            data.customer_id = client?.id || r.customer_id || "";
            await updateLead(r.id, activeCompanyId, data as any);
            queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
          } else {
            await updateCustomer(r.id, activeCompanyId, data as any);
          }
          queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
        } else {
          data.id = uid(type === "customer" ? "cust" : type);
          data.created_at = now();
          data.updated_at = now();
          if (type === "lead") {
            const client = await upsertClientFromLead({ ...data, notes: form.notes }, activeCompanyId, services[0] || "", pickedClientId || undefined);
            data.customer_id = client?.id || "";
            await insertLead(data as any);
            queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
          } else {
            await insertCustomer(data as any);
          }
          queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
        }
      }
      closeModal();
      toast("Record saved.");
    } catch (error) {
      toast(errorMessage(error, "Could not save record."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-bg">
      <section className="modal">
        <div className="modal-h">
          <h3>{titleize(title)}</h3>
          <button className="btn ghost slim" onClick={closeModal}>Close</button>
        </div>
        <div className="modal-b">
          {type === "job" ? (
            <div className="grid two">
              <Field label="Job/project title" value={form.title} onChange={v => set("title", v)} />
              <div className="field">
                <label>Client</label>
                <Select value={form.customer_id || ""} onChange={v => set("customer_id", v)} options={customers.map(c => ({ value: c.id, label: c.name }))} />
              </div>
              <SelectField label="Status" value={form.status} options={["planned", "scheduled", "in progress", "complete"]} onChange={v => set("status", v)} />
              <SelectField label="Service" value={form.service_type} options={services} onChange={v => set("service_type", v)} />
              <Field label="Scheduled date" value={form.scheduled_date} onChange={v => set("scheduled_date", v)} type="date" />
              <Field label="Estimated value" value={String(form.estimated_value)} onChange={v => set("estimated_value", v)} type="number" />
              <Field label="Address" value={form.address} onChange={v => set("address", v)} />
              <Field label="City" value={form.city} onChange={v => set("city", v)} />
              <Field label="State" value={form.state} onChange={v => set("state", v)} />
              <Field label="ZIP" value={form.zip} onChange={v => set("zip", v)} />
              <Field label="Google Drive folder URL" value={form.drive_folder_url} onChange={v => set("drive_folder_url", v)} />
              <Field label="Latitude" value={String(form.lat)} onChange={v => set("lat", v)} type="number" />
              <Field label="Longitude" value={String(form.lng)} onChange={v => set("lng", v)} type="number" />
            </div>
          ) : (
            <>
              {type === "lead" && !isEdit && (
                <div className="field">
                  <label>Existing client (optional)</label>
                  <Select
                    value={pickedClientId}
                    onChange={pickExistingClient}
                    options={[{ value: "", label: "— New client —" }, ...customers.map(c => ({ value: c.id, label: c.name }))]}
                  />
                </div>
              )}
              <div className="grid two">
                <Field label="Name" value={form.name} onChange={v => set("name", v)} />
                <Field label="Phone" value={form.phone} onChange={v => set("phone", v)} />
                <Field label="Email" value={form.email} onChange={v => set("email", v)} type="email" />
                <SelectField label="Service" value={form.service_type} options={services} onChange={v => set("service_type", v)} />
                {type === "lead" ? (
                  <div className="field">
                    <label>Pipeline stage</label>
                    <Select value={form.stage_id} onChange={v => set("stage_id", v)} options={stages.map(s => ({ value: s.id, label: s.name }))} />
                  </div>
                ) : (
                  <SelectField label="Status" value={form.status} options={["active", "past", "lost"]} onChange={v => set("status", v)} />
                )}
                {type === "lead" ? (
                  <Field label="Estimated value" value={String(form.value)} onChange={v => set("value", v)} type="number" />
                ) : (
                  <Field label="Source" value={form.source} onChange={v => set("source", v)} />
                )}
                <Field label="Address" value={form.address} onChange={v => set("address", v)} />
                <Field label="City" value={form.city} onChange={v => set("city", v)} />
                <Field label="State" value={form.state} onChange={v => set("state", v)} />
                <Field label="ZIP" value={form.zip} onChange={v => set("zip", v)} />
                {type === "customer" && <Field label="Google Drive folder URL" value={form.drive_folder_url} onChange={v => set("drive_folder_url", v)} />}
                <Field label="Latitude" value={String(form.lat)} onChange={v => set("lat", v)} type="number" />
                <Field label="Longitude" value={String(form.lng)} onChange={v => set("lng", v)} type="number" />
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows={3} value={form.notes} onChange={e => set("notes", e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={closeModal}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <Select value={value} onChange={onChange} options={options.map(opt => ({ value: opt, label: opt }))} />
    </div>
  );
}
