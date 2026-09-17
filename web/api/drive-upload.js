// Vercel serverless function — uploads a file (base64-encoded in the request
// body) into an already-provisioned Drive folder (drive-provision.js must
// have run for this entity first) and registers it in both `files` (the
// existing generic entity-attachment table RecordModal already reads) and
// `drive_files` (the richer Phase 3 registry: category, related transaction,
// sync status). Same server-side-refresh-token approach as drive-provision.js
// — see that file's header comment for why.
//
// Body size note: Vercel's default request body limit (~4.5MB on Hobby) plus
// base64's ~33% overhead caps this at a few MB per file — fine for receipt
// photos/PDFs, not for large video. A resumable/chunked upload is a known
// limitation for very large files (see the Phase 3 closing report).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

async function getAccessToken(supabase, companyId) {
  const { data: tokenRow } = await supabase.from("google_oauth_tokens").select("refresh_token").eq("company_id", companyId).maybeSingle();
  if (!tokenRow?.refresh_token) {
    throw new Error("Connect Google for this company in Integrations first (Calendar/Drive background sync).");
  }
  const { data: settingsRow } = await supabase.from("integration_settings").select("settings").eq("id", "default").maybeSingle();
  const clientId = settingsRow?.settings?.google_oauth?.client_id;
  if (!clientId) throw new Error("No Google OAuth client_id configured yet — import the OAuth JSON in Integrations first.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || "Could not refresh the Google access token.");
  return body.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const {
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    subfolder_key: subfolderKey = "",
    file_name: fileName,
    mime_type: mimeType = "application/octet-stream",
    file_base64: fileBase64,
    category = "",
    related_transaction_id: relatedTransactionId = null
  } = req.body || {};

  if (!companyId || !entityId || !fileName || !fileBase64 || (entityType !== "client" && entityType !== "job")) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }
  if (fileBase64.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: "File too large — max ~15MB per upload." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    const { data: membership } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!membership) {
      res.status(403).json({ error: "You are not a member of that company." });
      return;
    }

    const { data: folder } = await supabase
      .from("drive_folders")
      .select("drive_folder_id")
      .eq("company_id", companyId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("subfolder_key", subfolderKey)
      .maybeSingle();
    if (!folder) throw new Error("This folder hasn't been created yet — create/locate the Drive folder first.");

    const accessToken = await getAccessToken(supabase, companyId);
    const buffer = Buffer.from(fileBase64, "base64");
    const boundary = `filaho-${randomUUID()}`;
    const metadata = JSON.stringify({ name: fileName, parents: [folder.drive_folder_id] });
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`)
    ]);

    const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
      body: multipartBody
    });
    const uploadBody = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadBody.error?.message || "Drive upload failed.");

    const fileUrl = uploadBody.webViewLink || `https://drive.google.com/file/d/${uploadBody.id}/view`;

    await supabase.from("files").insert({
      id: `file_${randomUUID()}`,
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      name: fileName,
      url: fileUrl,
      provider: "google_drive"
    });

    const { error: registryError } = await supabase.from("drive_files").insert({
      id: `drivefile_${randomUUID()}`,
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      drive_folder_id: folder.drive_folder_id,
      drive_file_id: uploadBody.id,
      file_name: fileName,
      mime_type: mimeType,
      category,
      related_transaction_id: relatedTransactionId,
      sync_status: "synced"
    });
    if (registryError) throw registryError;

    res.status(200).json({ file_id: uploadBody.id, url: fileUrl });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
