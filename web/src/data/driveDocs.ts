import { supabase } from "../lib/supabaseClient";

// Calls the Drive endpoints with the caller's session token; they check
// company membership before touching Drive.
async function authedFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
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

// Creates or finds the Drive folder for a client or job (tree in
// web/api/drive-provision.js).
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

// FileReader, since this runs in the browser.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      // Drop the "data:<mime>;base64," prefix: the endpoint wants bare base64.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
