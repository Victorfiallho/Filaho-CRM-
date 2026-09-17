import { supabase } from "../lib/supabaseClient";
import type { DriveFile } from "../domain/types";

// Same authedFetch shape as data/adminUsers.ts — Authorization is the
// caller's own Supabase session token, checked server-side against
// company_members before anything Drive-related happens.
async function authedFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || "Request failed.");
  return json as T;
}

export interface ProvisionResult {
  folder_url: string;
  subfolders?: Record<string, string>;
}

// Creates (or locates, if already provisioned) the Drive folder for a client
// or a job — see web/api/drive-provision.js for the full tree it builds.
export function provisionDriveFolder(companyId: string, entityType: "client" | "job", entityId: string): Promise<ProvisionResult> {
  return authedFetch<ProvisionResult>("/api/drive-provision", { company_id: companyId, entity_type: entityType, entity_id: entityId });
}

export interface UploadResult {
  file_id: string;
  url: string;
}

export function uploadFileToDrive(params: {
  companyId: string;
  entityType: "client" | "job";
  entityId: string;
  subfolderKey?: string;
  fileName: string;
  mimeType: string;
  fileBase64: string;
  category?: string;
  relatedTransactionId?: string | null;
}): Promise<UploadResult> {
  return authedFetch<UploadResult>("/api/drive-upload", {
    company_id: params.companyId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    subfolder_key: params.subfolderKey || "",
    file_name: params.fileName,
    mime_type: params.mimeType,
    file_base64: params.fileBase64,
    category: params.category || "",
    related_transaction_id: params.relatedTransactionId || null
  });
}

// FileReader-based (not a Buffer/Node API — this runs in the browser).
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      // "data:<mime>;base64,<payload>" — only the payload after the comma is
      // valid as a bare base64 string for the upload endpoint.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export async function listDriveFiles(entityType: "client" | "job", entityId: string): Promise<DriveFile[]> {
  const { data, error } = await supabase.from("drive_files").select("*").eq("entity_type", entityType).eq("entity_id", entityId).order("upload_date", { ascending: false });
  if (error) throw error;
  return (data || []) as DriveFile[];
}
