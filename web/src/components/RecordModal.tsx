import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Select from "./Select";
import { listCustomers, insertCustomer, updateCustomer, deleteCustomer } from "../data/customers";
import { deleteFile, insertFile } from "../data/files";
import { geocodeAddress } from "../data/geocoding";
import { useCurrentAppUser, useFiles, useIntegrationSettings, useNotes, useUsers } from "../data/hooks";
import { insertJob, updateJob, deleteJob } from "../data/jobs";
import { upsertClientFromLead } from "../data/leadClientSync";
import { insertLead, updateLead, deleteLead } from "../data/leads";
import { deleteNote, insertNote } from "../data/notes";
import { now, uid } from "../domain/format";
import { titleize } from "../domain/format";
import { errorMessage } from "../lib/errorMessage";
import { openDrivePicker } from "../lib/googleDrivePicker";
import { connectGoogleWorkspace, googleAccessTokenFor } from "../lib/googleOAuth";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
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
  const { session } = useAuth();
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

  // Notes/files attach to an already-saved record via entity_id, so a
  // not-yet-created record (isEdit false, or no r.id yet) simply queries with
  // a null entityId — useNotes/useFiles are disabled in that case and return [].
  const notesEntityId = isEdit && r.id ? r.id : null;
  const { data: notes = [] } = useNotes(activeCompanyId, type, notesEntityId);
  const { data: files = [] } = useFiles(activeCompanyId, type, notesEntityId);
  const { data: users = [] } = useUsers();
  const { data: currentAppUser } = useCurrentAppUser();
  const { data: integrationSettings } = useIntegrationSettings();
  const userNameById = new Map(users.map(u => [u.id, u.name]));

  const [newNoteBody, setNewNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileUrl, setNewFileUrl] = useState("");
  const [addingFile, setAddingFile] = useState(false);

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
  const [deleting, setDeleting] = useState(false);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);

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

  // Auto-fills lat/lng on save when an address is given but coordinates
  // weren't set manually, so pins show up on Map & Routes without anyone
  // having to remember to click "Geocode visible records" afterward.
  // Best-effort: a failed/slow geocode never blocks the save itself.
  async function autoGeocode(data: { address?: string; city?: string; state?: string; zip?: string; lat?: unknown; lng?: unknown }) {
    if (!activeCompanyId) return;
    if (Number(data.lat) && Number(data.lng)) return;
    if (!data.address && !data.city && !data.zip) return;
    const apiKey = integrationSettings?.google_maps.api_key || "";
    if (!apiKey) return;
    try {
      const loc = await geocodeAddress(activeCompanyId, data.address || "", data.city || "", data.state || "", data.zip || "", apiKey);
      if (loc) {
        data.lat = loc.lat;
        data.lng = loc.lng;
      }
    } catch {
      // saving proceeds without coordinates; Map & Routes can still catch up later
    }
  }

  const titleType = type === "customer" ? "client" : type;
  const title = `${isEdit ? "Edit" : "New"} ${titleType}`;

  // Esc closes the modal from anywhere in it. Enter in a plain text input
  // jumps to the next field instead of doing nothing (or, on the last field,
  // saves) — like Tab, but Enter, since that's the muscle-memory most people
  // bring from other data-entry forms. Scoped to <input> only: a <textarea>
  // needs Enter for newlines, and the custom Select's own trigger/options
  // already use Enter/Space for their native open/choose behavior — hijacking
  // Enter there would break picking an option with the keyboard.
  function handleModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      closeModal();
      return;
    }
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    e.preventDefault();
    const container = modalBodyRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>("input, textarea, .cs-trigger"));
    const idx = focusables.indexOf(target);
    if (idx >= 0 && idx < focusables.length - 1) focusables[idx + 1].focus();
    else handleSave();
  }

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
        await autoGeocode(data);
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
        await autoGeocode(data);

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

  async function handleDelete() {
    if (!activeCompanyId || !r.id) return;
    const label = type === "job" ? "job" : type === "lead" ? "lead" : "client";
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      if (type === "job") {
        await deleteJob(r.id, activeCompanyId);
        queryClient.invalidateQueries({ queryKey: ["jobs", activeCompanyId] });
      } else if (type === "lead") {
        await deleteLead(r.id, activeCompanyId);
        queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
      } else {
        await deleteCustomer(r.id, activeCompanyId);
        queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
      }
      closeModal();
      toast("Record deleted.");
    } catch (error) {
      toast(errorMessage(error, "Could not delete record."));
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddNote() {
    if (!activeCompanyId || !r.id || !newNoteBody.trim()) return;
    setAddingNote(true);
    try {
      await insertNote({ company_id: activeCompanyId, entity_type: type, entity_id: r.id, body: newNoteBody.trim(), user_id: currentAppUser?.id || null });
      setNewNoteBody("");
      queryClient.invalidateQueries({ queryKey: ["notes", activeCompanyId, type, r.id] });
    } catch (error) {
      toast(errorMessage(error, "Could not add note."));
    } finally {
      setAddingNote(false);
    }
  }

  async function handleDeleteNote(id: string) {
    if (!activeCompanyId) return;
    try {
      await deleteNote(id, activeCompanyId);
      queryClient.invalidateQueries({ queryKey: ["notes", activeCompanyId, type, r.id] });
    } catch (error) {
      toast(errorMessage(error, "Could not delete note."));
    }
  }

  async function handleAddFile() {
    if (!activeCompanyId || !r.id || !newFileName.trim() || !newFileUrl.trim()) return;
    setAddingFile(true);
    try {
      await insertFile({ company_id: activeCompanyId, entity_type: type, entity_id: r.id, name: newFileName.trim(), url: newFileUrl.trim() });
      setNewFileName("");
      setNewFileUrl("");
      queryClient.invalidateQueries({ queryKey: ["files", activeCompanyId, type, r.id] });
    } catch (error) {
      toast(errorMessage(error, "Could not add file link."));
    } finally {
      setAddingFile(false);
    }
  }

  async function handleDeleteFile(id: string) {
    if (!activeCompanyId) return;
    try {
      await deleteFile(id, activeCompanyId);
      queryClient.invalidateQueries({ queryKey: ["files", activeCompanyId, type, r.id] });
    } catch (error) {
      toast(errorMessage(error, "Could not remove file link."));
    }
  }

  // Manual counterpart to scripts/send-reminders.mjs's daily automated
  // reminder cron — same web/api/send-notification.js endpoint, triggered
  // on demand instead of by a schedule. Prefers SMS when the client has a
  // phone on file (matches the automated job's preference), falls back to
  // email.
  async function handleSendReminderNow() {
    const customer = customers.find(c => c.id === form.customer_id);
    const to = customer?.phone || customer?.email;
    if (!to) { toast("This client has no phone or email on file."); return; }
    if (!session?.access_token) { toast("Your session expired — sign in again."); return; }
    const body = `Reminder: ${form.title || "your appointment"} is scheduled for ${form.scheduled_date || "soon"}.`;
    try {
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          type: customer?.phone ? "sms" : "email",
          to,
          subject: "Appointment reminder",
          body,
          from_email: integrationSettings?.email_sms.from_email,
          from_phone: integrationSettings?.email_sms.from_phone
        })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to send.");
      toast("Reminder sent.");
    } catch (error) {
      toast(errorMessage(error, "Could not send reminder."));
    }
  }

  // Real Drive file picker, next to the plain "paste a link" flow above —
  // reuses the same Drive OAuth token connectGoogleWorkspace mints for the
  // Integrations page's "Allow Drive" button, prompting for it here too if
  // this browser session doesn't have one yet.
  async function handleAttachFromDrive() {
    if (!activeCompanyId || !r.id) return;
    const clientId = integrationSettings?.google_oauth.client_id;
    const pickerApiKey = integrationSettings?.google_drive.picker_api_key;
    if (!clientId) { toast("Import the Google OAuth JSON in Integrations first."); return; }
    if (!pickerApiKey) { toast("Add a Google Picker API key in Integrations first."); return; }
    setAddingFile(true);
    try {
      let token = googleAccessTokenFor("drive");
      if (!token) {
        const result = await connectGoogleWorkspace(clientId, "drive");
        token = result.accessToken;
      }
      const picked = await openDrivePicker(token, pickerApiKey);
      if (!picked) return;
      await insertFile({ company_id: activeCompanyId, entity_type: type, entity_id: r.id, name: picked.name, url: picked.url, provider: "google_drive" });
      queryClient.invalidateQueries({ queryKey: ["files", activeCompanyId, type, r.id] });
    } catch (error) {
      toast(errorMessage(error, "Could not attach that Drive file."));
    } finally {
      setAddingFile(false);
    }
  }

  return (
    <div className="modal-bg">
      <section className="modal" onKeyDown={handleModalKeyDown}>
        <div className="modal-h">
          <h3>{titleize(title)}</h3>
          <button className="btn ghost slim" onClick={closeModal}>Close</button>
        </div>
        <div className="modal-b" ref={modalBodyRef}>
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
              {isEdit && (
                <button className="btn ghost slim" onClick={handleSendReminderNow} type="button">Send reminder now</button>
              )}
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
          {isEdit && r.id && (
            <div className="record-activity">
              <div className="grid two">
                <div className="field">
                  <label>Activity notes</label>
                  <div className="record-note-list">
                    {notes.length === 0 && <p className="sub">No notes yet.</p>}
                    {notes.map(n => (
                      <div className="record-note" key={n.id}>
                        <p>{n.body}</p>
                        <div className="record-note-meta">
                          <span className="sub">{userNameById.get(n.user_id || "") || "Someone"} · {new Date(n.created_at).toLocaleString()}</span>
                          <button className="btn ghost slim" onClick={() => handleDeleteNote(n.id)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <textarea rows={2} placeholder="Add a note..." value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)} />
                  <button className="btn ghost slim" onClick={handleAddNote} disabled={addingNote || !newNoteBody.trim()}>
                    {addingNote ? "Adding..." : "Add note"}
                  </button>
                </div>
                <div className="field">
                  <label>Files</label>
                  <div className="record-note-list">
                    {files.length === 0 && <p className="sub">No files linked yet.</p>}
                    {files.map(f => (
                      <div className="record-note" key={f.id}>
                        <div className="record-note-meta">
                          <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                          <button className="btn ghost slim" onClick={() => handleDeleteFile(f.id)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <input placeholder="File name" value={newFileName} onChange={e => setNewFileName(e.target.value)} />
                  <input placeholder="Link URL (Google Drive, etc.)" value={newFileUrl} onChange={e => setNewFileUrl(e.target.value)} />
                  <div className="inline-actions">
                    <button className="btn ghost slim" onClick={handleAddFile} disabled={addingFile || !newFileName.trim() || !newFileUrl.trim()}>
                      {addingFile ? "Adding..." : "Add file link"}
                    </button>
                    <button className="btn ghost slim" onClick={handleAttachFromDrive} disabled={addingFile}>Attach from Drive</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-f">
          {isEdit && (
            <button
              className="btn ghost slim"
              style={{ marginRight: "auto", color: "var(--red)" }}
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
          <button className="btn ghost" onClick={closeModal} disabled={deleting}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving || deleting}>{saving ? "Saving..." : "Save"}</button>
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
