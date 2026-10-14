import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, FolderOpen, Link2, MapPin, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ClientPicker from "./ClientPicker";
import ConsentPanel from "./ConsentPanel";
import Select, { type SelectOption } from "./Select";
import { summarizeJob, type JobAiSummary } from "../data/aiSummary";
import { listCustomers, insertCustomer, updateCustomer, deleteCustomer } from "../data/customers";
import { fileToBase64, provisionDriveFolder, uploadFileToDrive } from "../data/driveDocs";
import { deleteFile, insertFile } from "../data/files";
import { geocodeAddress } from "../data/geocoding";
import { useCurrentAppUser, useFiles, useIntegrationSettings, useJobs, useLeads, useMetaAdsInsights, useNotes, usePermissions, useUsers } from "../data/hooks";
import { insertJob, updateJob, deleteJob } from "../data/jobs";
import { upsertClientFromLead } from "../data/leadClientSync";
import { insertLead, updateLead, deleteLead } from "../data/leads";
import { deleteNote, insertNote } from "../data/notes";
import { createProjectFinancials } from "../data/projectFinancials";
import { dealsForClient, dealTitle } from "../domain/deals";
import { formatDateTime, formatDay, money, now, uid } from "../domain/format";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { useConfirm } from "../state/ConfirmContext";
import FileButton from "./FileButton";
import { LOST_REASONS } from "../domain/followUp";
import { findJobForLead, jobDraftFromLead } from "../domain/leadConversion";
import { isLostStage } from "../domain/pipelineStages";
import { PROJECT_DRIVE_SUBFOLDERS } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { openDrivePicker } from "../lib/googleDrivePicker";
import { connectGoogleWorkspace, googleAccessTokenFor } from "../lib/googleOAuth";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

// The create/edit form for clients, deals and jobs.
export default function RecordModal() {
  const { modal } = useModal();
  if (!modal) return null;
  return createPortal(<RecordModalContent key={modal.record?.id || modal.type} />, document.getElementById("modal-root")!);
}

function RecordModalContent() {
  // Every hook must run on every render, so the "no modal / no company" case
  // returns null only after them.
  const { modal, closeModal, openRecordModal } = useModal();
  const { locale, t } = useT();
  const { confirm } = useConfirm();
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

  // Notes and files hang off a saved record; a new one has none.
  const notesEntityId = isEdit && r.id ? r.id : null;
  const { data: notes = [] } = useNotes(activeCompanyId, type, notesEntityId);
  const { data: files = [] } = useFiles(activeCompanyId, type, notesEntityId);
  const { data: users = [] } = useUsers();
  const { data: currentAppUser } = useCurrentAppUser();
  const { data: integrationSettings } = useIntegrationSettings();
  const { has: hasPermission } = usePermissions();
  const { data: adInsights = [] } = useMetaAdsInsights(type === "lead" ? activeCompanyId : null);
  const { data: jobs = [] } = useJobs(type === "lead" && isEdit ? activeCompanyId : null);
  const linkedJob = type === "lead" && isEdit && r.id ? findJobForLead(r.id, jobs) : undefined;
  // A client's deals (leads), listed on the client and opened from there.
  const { data: allLeads = [] } = useLeads(type === "customer" && isEdit ? activeCompanyId : null);
  const clientDeals = type === "customer" && isEdit && r.id ? dealsForClient(allLeads, r.id, stages) : [];
  const userNameById = new Map(users.map(u => [u.id, u.name]));
  // Campaigns synced from Meta Ads, as a dropdown: campaign_id must match
  // Meta's opaque id exactly for get_campaign_roi() to join on it.
  const campaignOptions = Array.from(new Map(adInsights.map(a => [a.campaign_id, a.campaign_name || a.campaign_id])).entries());

  const [newNoteBody, setNewNoteBody] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileUrl, setNewFileUrl] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const [provisioningFolder, setProvisioningFolder] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadSubfolder, setUploadSubfolder] = useState<string>(PROJECT_DRIVE_SUBFOLDERS[2]);
  const [aiSummary, setAiSummary] = useState<JobAiSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // A deal's person is its client. The deal form picks one (or starts a
  // new one, `newClient`); the client's contact fields are copied onto the
  // deal by the database (leads_copy_client_contact), never typed here.
  const [pickedClientId, setPickedClientId] = useState<string>(() => (type === "lead" && r.customer_id) || "");
  const [newClient, setNewClient] = useState(false);

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
    campaign_id: r.campaign_id || "",
    scheduled_date: r.scheduled_date || "",
    estimated_value: r.estimated_value ?? "",
    address: r.address || "",
    city: r.city || "",
    state: r.state || "",
    zip: r.zip || "",
    drive_folder_url: r.drive_folder_url || "",
    lat: r.lat ?? "",
    lng: r.lng ?? "",
    notes: r.notes || "",
    owner_user_id: r.owner_user_id || "",
    next_action: r.next_action || "",
    next_action_date: r.next_action_date || "",
    lost_reason: r.lost_reason || ""
  }));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);

  if (!modal || !activeCompanyId) return null;

  const kindKey = type === "customer" ? "customer" : type;
  const title = t(`rec.${isEdit ? "edit" : "new"}.${kindKey}` as MessageKey);
  const recordName = isEdit ? (type === "lead" ? [r.title, r.name].filter(Boolean).join(" · ") : String(r.name || r.title || "")) : "";

  // Every "new" and "open record" path goes through this modal, so the
  // permission check lives here. Deleting counts as editing.
  const blocked = isEdit ? !hasPermission("edit") : !hasPermission("create");
  if (blocked) {
    return (
      <div className="modal-bg" onClick={closeModal}>
        <section className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: "min(440px,100%)" }} onClick={e => e.stopPropagation()}>
          <div className="modal-h">
            <h3>{title}</h3>
            <button className="round-btn" onClick={closeModal} aria-label={t("rec.close")}><X aria-hidden="true" /></button>
          </div>
          <div className="modal-b">
            <p className="sub">{t(isEdit ? "rec.noPermission.edit" : "rec.noPermission.create")}</p>
          </div>
          <div className="modal-f">
            <button className="btn ghost" onClick={closeModal}>{t("rec.close")}</button>
          </div>
        </section>
      </div>
    );
  }

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));
  // A new deal or job with no owner picked belongs to whoever creates it, or
  // the "Mine" filters would start empty.
  const ownerForSave = form.owner_user_id || (isEdit ? "" : currentAppUser?.id || "");
  const ownerOptions = [{ value: "", label: t("rec.unassigned") }, ...users.map(u => ({ value: u.id, label: u.name }))];
  const leadIsLost = type === "lead" && isLostStage(form.stage_id, stages);

  const pickClient = (clientId: string) => {
    setPickedClientId(clientId);
    setNewClient(false);
  };
  // "+ New client" with what was typed in the search: digits go to phone,
  // an @ to email, anything else to the name.
  const startNewClient = (typed: string) => {
    const text = typed.trim();
    setNewClient(true);
    setPickedClientId("");
    setForm(f => ({
      ...f,
      name: /@/.test(text) || /^[\d\s()+-]{3,}$/.test(text) ? "" : text,
      phone: /^[\d\s()+-]{3,}$/.test(text) ? text : "",
      email: /@/.test(text) ? text : "",
      address: "", city: "", state: "", zip: ""
    }));
  };

  // Fills lat/lng on save when there's an address but no coordinates, so the
  // pin shows up on the map. Best-effort: never blocks the save.
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
      // saved without coordinates; the map can geocode it later
    }
  }

  // Esc closes. Enter in a text input moves to the next field (saves on the
  // last one). Inputs only: textareas need Enter for newlines, and the custom
  // Select uses Enter to pick an option.
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
    if (type === "lead" ? !pickedClientId && !(newClient && form.name.trim()) : !form.name && !form.title) {
      toast(t(type === "lead" ? (newClient ? "rec.t.nameRequired" : "deal.t.pickClient") : "rec.t.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      if (type === "job") {
        // A job needs a client picked explicitly; never default to the first one.
        const jobCustomerId = form.customer_id || "";
        if (!jobCustomerId) {
          toast(t("rec.t.pickClient"));
          return;
        }
        // A job's location is its client's: copied from the client record, never
        // typed on the job.
        const jobCustomer = customers.find(c => c.id === jobCustomerId);
        const data = {
          company_id: activeCompanyId,
          title: form.title,
          customer_id: jobCustomerId,
          status: form.status || "planned",
          service_type: form.service_type,
          scheduled_date: form.scheduled_date,
          estimated_value: Number(form.estimated_value || 0),
          address: jobCustomer?.address || "",
          city: jobCustomer?.city || "",
          state: jobCustomer?.state || "",
          zip: jobCustomer?.zip || "",
          drive_folder_url: form.drive_folder_url,
          owner_user_id: ownerForSave,
          lat: Number(jobCustomer?.lat || 0) || "",
          lng: Number(jobCustomer?.lng || 0) || ""
        };
        await autoGeocode(data);
        if (isEdit && r.id) {
          await updateJob(r.id, activeCompanyId, data as any);
        } else {
          const newJobId = uid("job");
          const leadId = (r.lead_id as string | undefined) || null;
          await insertJob({ ...(data as any), lead_id: leadId, id: newJobId, created_at: now() });
          // A job converted from a won deal starts its costing with the deal's value
          // as the contract.
          if (leadId) {
            createProjectFinancials({ company_id: activeCompanyId, job_id: newJobId, original_contract_value: data.estimated_value })
              .catch(error => toastError(errorMessage(error, t("rec.t.financialsError"))));
          }
          provisionDriveFolder(activeCompanyId, "job", newJobId).catch(error =>
            toastError(errorMessage(error, t("rec.t.jobFolderError")))
          );
        }
        queryClient.invalidateQueries({ queryKey: ["jobs", activeCompanyId] });
      } else if (type === "lead") {
        // The deal's client: the one picked, or a new one from the inline fields
        // (matched by phone, email or name first, so an existing person isn't
        // duplicated).
        let customerId = pickedClientId;
        if (!customerId) {
          const contact: Record<string, any> = {
            company_id: activeCompanyId, name: form.name.trim(), phone: form.phone, email: form.email,
            address: form.address, city: form.city, state: form.state, zip: form.zip, lat: "", lng: ""
          };
          await autoGeocode(contact);
          const client = await upsertClientFromLead({ ...contact, source: "Manual" }, activeCompanyId, form.service_type || services[0] || "");
          customerId = client.id;
        }
        const clientName = customers.find(c => c.id === customerId)?.name || form.name.trim();
        const matchedCampaign = campaignOptions.find(([id]) => id === form.campaign_id);
        const data: Record<string, any> = {
          company_id: activeCompanyId,
          customer_id: customerId,
          name: clientName,
          title: form.title.trim(),
          service_type: form.service_type,
          stage_id: form.stage_id,
          value: Number(form.value || 0),
          campaign_id: form.campaign_id || null,
          campaign_name: matchedCampaign?.[1] || null,
          owner_user_id: ownerForSave,
          next_action: form.next_action,
          next_action_date: form.next_action_date,
          // A reason only means something while the deal sits in a lost stage.
          lost_reason: leadIsLost ? form.lost_reason : ""
        };
        if (isEdit && r.id) {
          await updateLead(r.id, activeCompanyId, data as any);
        } else {
          // Only a new deal typed here is "Manual"; editing keeps the original source.
          await insertLead({ ...data, id: uid("lead"), source: "Manual", created_at: now(), updated_at: now() } as any);
        }
        queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
        queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
      } else {
        // Clients only: notes and drive_folder_url aren't columns on deals.
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
        data.status = form.status;
        data.source = form.source;
        data.notes = form.notes;
        data.drive_folder_url = form.drive_folder_url;
        await autoGeocode(data);

        if (isEdit && r.id) {
          await updateCustomer(r.id, activeCompanyId, data as any);
          // The database copies the new contact details onto their deals.
          queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
        } else {
          data.id = uid("cust");
          data.created_at = now();
          data.updated_at = now();
          await insertCustomer(data as any);
          provisionDriveFolder(activeCompanyId, "client", data.id).catch(error =>
            toastError(errorMessage(error, t("rec.t.clientFolderError")))
          );
        }
        queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
      }
      closeModal();
      toast(t("rec.t.saved"));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.saveError")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!activeCompanyId || !r.id) return;
    const label = t(type === "job" ? "record.job" : type === "lead" ? "record.lead" : "record.client");
    if (!(await confirm({ message: t("confirm.deleteRecord", { label }), danger: true }))) return;
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
      toast(t("rec.t.deleted"));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.deleteError")));
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
      toastError(errorMessage(error, t("rec.t.noteError")));
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
      toastError(errorMessage(error, t("rec.t.noteDeleteError")));
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
      toastError(errorMessage(error, t("rec.t.fileError")));
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
      toastError(errorMessage(error, t("rec.t.fileDeleteError")));
    }
  }

  // Sends a reminder now, the manual twin of scripts/send-reminders.mjs: SMS
  // when the client has a phone, else email.
  async function handleSendReminderNow() {
    const customer = customers.find(c => c.id === form.customer_id);
    const to = customer?.phone || customer?.email;
    if (!to) { toast(t("rec.t.noContact")); return; }
    if (!session?.access_token) { toast(t("rec.t.sessionExpired")); return; }
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
      toast(t("rec.t.reminderSent"));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.reminderError")));
    }
  }

  async function handleSummarize() {
    if (!r.id) return;
    setSummarizing(true);
    try {
      setAiSummary(await summarizeJob(r.id));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.summaryError")));
    } finally {
      setSummarizing(false);
    }
  }

  // Pick a real Drive file, asking for the Drive token if this browser
  // session doesn't have one.
  async function handleAttachFromDrive() {
    if (!activeCompanyId || !r.id) return;
    const clientId = integrationSettings?.google_oauth.client_id;
    const pickerApiKey = integrationSettings?.google_drive.picker_api_key;
    if (!clientId) { toast(t("rec.t.needOAuth")); return; }
    if (!pickerApiKey) { toast(t("rec.t.needPicker")); return; }
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
      toastError(errorMessage(error, t("rec.t.driveAttachError")));
    } finally {
      setAddingFile(false);
    }
  }

  // Manual version of the automatic folder creation in handleSave, for older
  // records or when Google wasn't connected yet.
  async function handleProvisionFolder() {
    if (!activeCompanyId || !r.id) return;
    setProvisioningFolder(true);
    try {
      const result = await provisionDriveFolder(activeCompanyId, type === "job" ? "job" : "client", r.id);
      set("drive_folder_url", result.folder_url);
      queryClient.invalidateQueries({ queryKey: [type === "job" ? "jobs" : "customers", activeCompanyId] });
      toast(t("rec.t.folderReady"));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.folderError")));
    } finally {
      setProvisioningFolder(false);
    }
  }

  async function handleUploadToDrive(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!activeCompanyId || !r.id || !file) return;
    setUploadingFile(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await uploadFileToDrive({
        companyId: activeCompanyId,
        entityType: type === "job" ? "job" : "client",
        entityId: r.id,
        subfolderKey: type === "job" ? uploadSubfolder : "",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileBase64
      });
      queryClient.invalidateQueries({ queryKey: ["files", activeCompanyId, type, r.id] });
      toast(t("rec.t.uploaded"));
    } catch (error) {
      toastError(errorMessage(error, t("rec.t.uploadError")));
    } finally {
      setUploadingFile(false);
    }
  }

  // Read-only location on the job form: the client's address.
  const jobLocationCustomer = type === "job" ? customers.find(c => c.id === form.customer_id) : undefined;

  const driveFolderField = (openLabel: string) => (
    <div className="field">
      <span className="field-label">{t("rec.driveFolder")}</span>
      <div className="inline-actions">
        {form.drive_folder_url && <a className="btn ghost slim" href={form.drive_folder_url} target="_blank" rel="noreferrer"><FolderOpen aria-hidden="true" />{openLabel}</a>}
        {isEdit && (
          <button className="btn ghost slim" type="button" onClick={handleProvisionFolder} disabled={provisioningFolder}>
            {provisioningFolder ? t("rec.working") : form.drive_folder_url ? t("rec.relocateFolder") : t("rec.createFolder")}
          </button>
        )}
        {!form.drive_folder_url && !isEdit && <span className="sub">—</span>}
      </div>
    </div>
  );

  return (
    <div className="modal-bg">
      <section className="modal record-modal" role="dialog" aria-modal="true" aria-labelledby="record-modal-title" onKeyDown={handleModalKeyDown}>
        <div className="modal-h">
          <div className="modal-h-text">
            <h3 id="record-modal-title">{title}</h3>
            {recordName && <span className="sub">{recordName}</span>}
          </div>
          <button className="round-btn" onClick={closeModal} aria-label={t("rec.close")}><X aria-hidden="true" /></button>
        </div>
        <div className="modal-b" ref={modalBodyRef}>
          {type === "job" ? (
            <>
              <FormSection title={t("rec.sec.job")}>
                <div className="grid two">
                  <Field label={t("rec.jobTitle")} value={form.title} onChange={v => set("title", v)} wide />
                  <SelectBox label={t("rec.client")} value={form.customer_id || ""} onChange={v => set("customer_id", v)} options={[{ value: "", label: t("rec.pickClient"), disabled: true }, ...customers.map(c => ({ value: c.id, label: c.name }))]} />
                  <SelectBox label={t("rec.status")} value={form.status} onChange={v => set("status", v)} options={["planned", "scheduled", "in progress", "complete"].map(s => ({ value: s, label: cap(t(`status.${s}` as MessageKey)) }))} />
                  <SelectBox label={t("rec.service")} value={form.service_type} onChange={v => set("service_type", v)} options={services.map(s => ({ value: s, label: s }))} />
                  <SelectBox label={t("rec.owner")} value={ownerForSave} onChange={v => set("owner_user_id", v)} options={ownerOptions} />
                  <Field label={t("rec.scheduledDate")} value={form.scheduled_date} onChange={v => set("scheduled_date", v)} type="date" />
                  <Field label={t("rec.value")} value={String(form.estimated_value)} onChange={v => set("estimated_value", v)} type="number" />
                </div>
              </FormSection>
              <FormSection title={t("rec.location")}>
                <p className="sub record-location">
                  <MapPin aria-hidden="true" />
                  {jobLocationCustomer?.address || jobLocationCustomer?.city
                    ? [jobLocationCustomer.address, jobLocationCustomer.city, jobLocationCustomer.state, jobLocationCustomer.zip].filter(Boolean).join(", ")
                    : t("rec.noLocation")}
                </p>
                {driveFolderField(t("rec.openProjectFolder"))}
                {isEdit && (
                  <div className="inline-actions">
                    <button className="btn ghost slim" onClick={handleSendReminderNow} type="button"><Send aria-hidden="true" />{t("rec.sendReminder")}</button>
                    <button className="btn ghost slim" onClick={handleSummarize} type="button" disabled={summarizing}>
                      <Sparkles aria-hidden="true" />{summarizing ? t("rec.summarizing") : t("rec.aiSummary")}
                    </button>
                  </div>
                )}
                {aiSummary && (
                  <div className="record-ai">
                    <p><b>{t("rec.currentState")}</b> {aiSummary.summary}</p>
                    <p><b>{t("rec.nextStepLabel")}</b> {aiSummary.next_step}</p>
                  </div>
                )}
              </FormSection>
            </>
          ) : (
            <>
              {type === "lead" ? (
                <FormSection title={t("deal.sec.client")}>
                  {newClient ? (
                    <div className="new-client">
                      <div className="grid two">
                        <Field label={t("rec.name")} value={form.name} onChange={v => set("name", v)} />
                        <Field label={t("rec.phone")} value={form.phone} onChange={v => set("phone", v)} type="tel" />
                        <Field label={t("rec.email")} value={form.email} onChange={v => set("email", v)} type="email" />
                        <Field label={t("rec.address")} value={form.address} onChange={v => set("address", v)} />
                      </div>
                      <div className="form-row three">
                        <Field label={t("rec.city")} value={form.city} onChange={v => set("city", v)} />
                        <Field label={t("rec.state")} value={form.state} onChange={v => set("state", v)} />
                        <Field label={t("rec.zip")} value={form.zip} onChange={v => set("zip", v)} />
                      </div>
                      <button type="button" className="link-btn" onClick={() => setNewClient(false)}>{t("deal.searchInstead")}</button>
                    </div>
                  ) : (
                    <ClientPicker
                      customers={customers}
                      value={pickedClientId}
                      onPick={pickClient}
                      onNew={startNewClient}
                      onEdit={isEdit ? client => openRecordModal("customer", client) : undefined}
                    />
                  )}
                </FormSection>
              ) : (
                <FormSection title={t("rec.sec.contact")}>
                  <div className="grid two">
                    <Field label={t("rec.name")} value={form.name} onChange={v => set("name", v)} />
                    <Field label={t("rec.phone")} value={form.phone} onChange={v => set("phone", v)} type="tel" />
                    <Field label={t("rec.email")} value={form.email} onChange={v => set("email", v)} type="email" />
                    <SelectBox label={t("rec.service")} value={form.service_type} onChange={v => set("service_type", v)} options={services.map(s => ({ value: s, label: s }))} />
                  </div>
                </FormSection>
              )}

              <FormSection title={t(type === "lead" ? "rec.sec.deal" : "rec.sec.details")}>
                <div className="grid two">
                  {type === "lead" ? (
                    <>
                      <SelectBox label={t("rec.service")} value={form.service_type} onChange={v => set("service_type", v)} options={services.map(s => ({ value: s, label: s }))} />
                      <Field label={t("rec.dealTitle")} value={form.title} onChange={v => set("title", v)} placeholder={form.service_type || t("rec.dealTitlePlaceholder")} />
                      <SelectBox label={t("rec.stage")} value={form.stage_id} onChange={v => set("stage_id", v)} options={stages.map(s => ({ value: s.id, label: s.name }))} />
                      <Field label={t("rec.value")} value={String(form.value)} onChange={v => set("value", v)} type="number" />
                      <SelectBox label={t("rec.owner")} value={ownerForSave} onChange={v => set("owner_user_id", v)} options={ownerOptions} />
                      <SelectBox
                        label={t("rec.campaign")}
                        value={form.campaign_id}
                        onChange={v => set("campaign_id", v)}
                        options={[{ value: "", label: t("rec.none") }, ...campaignOptions.map(([id, name]) => ({ value: id || "", label: name || id || "" }))]}
                      />
                      {leadIsLost ? (
                        <SelectBox
                          label={t("rec.lostReason")}
                          value={form.lost_reason}
                          onChange={v => set("lost_reason", v)}
                          options={[{ value: "", label: t("rec.pickReason") }, ...LOST_REASONS.map(reason => ({ value: reason, label: t(`lostReason.${reason}` as MessageKey) }))]}
                        />
                      ) : (
                        <>
                          <Field label={t("rec.nextStep")} value={form.next_action} onChange={v => set("next_action", v)} />
                          <Field label={t("rec.nextStepDate")} value={form.next_action_date} onChange={v => set("next_action_date", v)} type="date" />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <SelectBox label={t("rec.status")} value={form.status} onChange={v => set("status", v)} options={["active", "past", "lost"].map(s => ({ value: s, label: cap(t(`status.${s}` as MessageKey)) }))} />
                      <Field label={t("rec.source")} value={form.source} onChange={v => set("source", v)} />
                    </>
                  )}
                </div>
              </FormSection>

              {type === "customer" && isEdit && r.id && (
                <FormSection title={t("rec.sec.deals")}>
                  {clientDeals.length === 0 ? (
                    <p className="sub">{t("rec.noDeals")}</p>
                  ) : (
                    <ul className="deal-list">
                      {clientDeals.map(deal => {
                        const stage = stages.find(s => s.id === deal.stage_id);
                        return (
                          <li key={deal.id}>
                            <button type="button" className="deal-row" onClick={() => openRecordModal("lead", deal)}>
                              <span className="deal-dot" style={{ background: stage?.color || "var(--muted-soft)" }} aria-hidden="true" />
                              <span className="deal-main">
                                <b>{dealTitle(deal) || t("rec.untitledDeal")}</b>
                                <span className="sub">{stage?.name || deal.stage_id}{deal.created_at ? ` · ${formatDay(deal.created_at, undefined, locale)}` : ""}</span>
                              </span>
                              {Number(deal.value) > 0 && <span className="deal-value">{money(Number(deal.value))}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {hasPermission("create") && (
                    <button
                      type="button"
                      className="btn ghost slim"
                      onClick={() => openRecordModal("lead", undefined, {
                        customer_id: r.id, name: form.name, phone: form.phone, email: form.email,
                        address: form.address, city: form.city, state: form.state, zip: form.zip, service_type: form.service_type
                      })}
                    >
                      <Plus aria-hidden="true" />{t("rec.newDeal")}
                    </button>
                  )}
                </FormSection>
              )}

              {type !== "lead" && <FormSection title={t("rec.sec.address")}>
                <Field label={t("rec.address")} value={form.address} onChange={v => set("address", v)} />
                <div className="form-row three">
                  <Field label={t("rec.city")} value={form.city} onChange={v => set("city", v)} />
                  <Field label={t("rec.state")} value={form.state} onChange={v => set("state", v)} />
                  <Field label={t("rec.zip")} value={form.zip} onChange={v => set("zip", v)} />
                </div>
                {/* Coordinates are filled automatically from the address on save,
                    so they're tucked away for the rare manual correction. */}
                <details className="advanced-fields">
                  <summary>{t("rec.coords")}</summary>
                  <div className="grid two">
                    <Field label={t("rec.lat")} value={String(form.lat)} onChange={v => set("lat", v)} type="number" />
                    <Field label={t("rec.lng")} value={String(form.lng)} onChange={v => set("lng", v)} type="number" />
                  </div>
                </details>
                {type === "customer" && driveFolderField(t("rec.openClientFolder"))}
              </FormSection>}

              {type !== "lead" && (
                <FormSection title={t("rec.sec.notes")}>
                  <TextArea label={t("rec.notes")} value={form.notes} onChange={v => set("notes", v)} rows={3} hideLabel />
                </FormSection>
              )}
            </>
          )}
          {isEdit && r.id && (type === "lead" || type === "customer") && (
            <FormSection title={t("rec.sec.consent")}>
              <ConsentPanel companyId={activeCompanyId} kind={type} record={r} />
            </FormSection>
          )}
          {isEdit && r.id && (
            <FormSection title={t("rec.sec.activity")}>
              <div className="record-activity-grid">
                <div className="record-activity-col">
                  <span className="field-label">{t("rec.activityNotes")}</span>
                  <div className="record-note-list">
                    {notes.length === 0 && <p className="sub">{t("rec.noNotes")}</p>}
                    {notes.map(n => (
                      <div className="record-note" key={n.id}>
                        <p>{n.body}</p>
                        <div className="record-note-meta">
                          <span className="sub">{userNameById.get(n.user_id || "") || t("rec.someone")} · {formatDateTime(n.created_at, locale)}</span>
                          <button className="round-btn danger small" type="button" onClick={() => handleDeleteNote(n.id)} aria-label={t("rec.remove")} title={t("rec.remove")}><Trash2 aria-hidden="true" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <textarea rows={2} aria-label={t("rec.addNote")} placeholder={t("rec.addNotePlaceholder")} value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)} />
                  <button className="btn ghost slim" type="button" onClick={handleAddNote} disabled={addingNote || !newNoteBody.trim()}>
                    <Plus aria-hidden="true" />{addingNote ? t("rec.adding") : t("rec.addNote")}
                  </button>
                </div>
                <div className="record-activity-col">
                  <span className="field-label">{t("rec.files")}</span>
                  <div className="record-note-list">
                    {files.length === 0 && <p className="sub">{t("rec.noFiles")}</p>}
                    {files.map(f => (
                      <div className="record-note" key={f.id}>
                        <div className="record-note-meta">
                          <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                          <button className="round-btn danger small" type="button" onClick={() => handleDeleteFile(f.id)} aria-label={t("rec.remove")} title={t("rec.remove")}><Trash2 aria-hidden="true" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <input aria-label={t("rec.fileName")} placeholder={t("rec.fileName")} value={newFileName} onChange={e => setNewFileName(e.target.value)} />
                  <input aria-label={t("rec.fileUrl")} placeholder={t("rec.fileUrl")} value={newFileUrl} onChange={e => setNewFileUrl(e.target.value)} />
                  <div className="inline-actions">
                    <button className="btn ghost slim" type="button" onClick={handleAddFile} disabled={addingFile || !newFileName.trim() || !newFileUrl.trim()}>
                      <Link2 aria-hidden="true" />{addingFile ? t("rec.adding") : t("rec.addFile")}
                    </button>
                    <button className="btn ghost slim" type="button" onClick={handleAttachFromDrive} disabled={addingFile}>{t("rec.attachDrive")}</button>
                  </div>
                  {type === "job" && (
                    <SelectBox label={t("rec.uploadFolder")} value={uploadSubfolder} onChange={setUploadSubfolder} options={PROJECT_DRIVE_SUBFOLDERS.map(s => ({ value: s, label: s }))} />
                  )}
                  <div>
                    <FileButton
                      label={t("file.upload")}
                      disabled={uploadingFile || !form.drive_folder_url}
                      resetAfterPick
                      onFiles={files => handleUploadToDrive(files)}
                    />
                  </div>
                  {!form.drive_folder_url && <p className="sub">{t("rec.needFolder")}</p>}
                  {uploadingFile && <p className="sub">{t("rec.uploading")}</p>}
                </div>
              </div>
            </FormSection>
          )}
        </div>
        <div className="modal-f record-modal-f">
          <div className="modal-f-start">
            {isEdit && (
              <button className="btn ghost danger-text" type="button" onClick={handleDelete} disabled={saving || deleting}>
                <Trash2 aria-hidden="true" />{deleting ? t("rec.deleting") : t("rec.delete")}
              </button>
            )}
            {type === "lead" && isEdit && (linkedJob ? (
              <button className="btn ghost" type="button" onClick={() => openRecordModal("job", linkedJob)}><BriefcaseBusiness aria-hidden="true" />{t("rec.openJob")}</button>
            ) : hasPermission("create") && (
              <button className="btn ghost accent-outline" type="button" onClick={() => openRecordModal("job", undefined, { ...jobDraftFromLead({ ...r, ...form, value: Number(form.value || 0) }) })}>
                <BriefcaseBusiness aria-hidden="true" /><span className="label-long">{t("rec.createJob")}</span><span className="label-short" aria-hidden="true">{t("rec.createJobShort")}</span>
              </button>
            ))}
          </div>
          <div className="inline-actions">
            <button className="btn ghost" type="button" onClick={closeModal} disabled={deleting}>{t("rec.cancel")}</button>
            <button className="btn" type="button" onClick={handleSave} disabled={saving || deleting}>{saving ? t("rec.saving") : t("rec.save")}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <h4 className="form-section-title">{title}</h4>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text", wide, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; wide?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 3, hideLabel }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      <textarea id={id} rows={rows} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function SelectBox({ label, value, options, onChange }: { label: string; value: string; options: SelectOption[]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onChange={onChange} options={options} aria-label={label} />
    </div>
  );
}
