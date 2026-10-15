import { apiFetch } from "../lib/apiFetch";

export interface ProvisionResult {
  folder_url: string;
  subfolders?: Record<string, string>;
}

// Creates or finds the Drive folder for a client or job (tree in
// web/api/_lib/driveProvision.js).
export function provisionDriveFolder(companyId: string, entityType: "client" | "job", entityId: string): Promise<ProvisionResult> {
  return apiFetch<ProvisionResult>("/api/drive?op=provision", { company_id: companyId, entity_type: entityType, entity_id: entityId });
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
  return apiFetch<UploadResult>("/api/drive?op=upload", {
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
