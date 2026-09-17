// Vercel serverless function — creates/locates the Google Drive folder tree
// for a client or a job: "Fialho CRM" (root) -> Company -> Client -> Job ->
// the 8 project subfolders (spec section 10). Runs server-side against the
// company's stored Calendar/Drive refresh token (google_oauth_tokens,
// service_role-only, never exposed to the client — same token
// sync-google-calendar.mjs already uses) rather than a client-side popup
// token, so folder creation works reliably from a background trigger
// (RecordModal calling this right after creating a client/job) without
// depending on a live Google popup in that tab.
//
// "Find or create" by name under the known parent, matched against
// drive_folders first (fast path, no Drive API call once cached) so this
// never creates a duplicate folder on a second call for the same entity.
//
// Same Bearer-token + company-membership pattern as every other web/api/*.js
// file. Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_SECRET
// (all already set for the Calendar sync feature).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const PROJECT_SUBFOLDERS = [
  "01 - Proposal & Contract",
  "02 - Invoices & Payments",
  "03 - Costs & Receipts",
  "04 - Materials & Orders",
  "05 - Photos & Videos",
  "06 - Designs & Measurements",
  "07 - Change Orders",
  "08 - Financial Reports"
];

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

async function driveFindFolder(accessToken, name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  const q = `name='${escaped}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || "Drive search failed.");
  return body.files?.[0] || null;
}

async function driveCreateFolder(accessToken, name, parentId) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || "Drive folder creation failed.");
  return body;
}

// Cache-first: a folder already recorded in drive_folders is trusted without
// re-checking Drive (this app is the only writer of its own folders, given
// the drive.file scope — nothing else can rename/move them out from under us
// through this same token). Only misses reach the Drive API.
async function ensureFolder(supabase, accessToken, companyId, entityType, entityId, subfolderKey, name, parentDriveFolderId) {
  const { data: existing } = await supabase
    .from("drive_folders")
    .select("*")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("subfolder_key", subfolderKey)
    .maybeSingle();
  if (existing) return existing;

  const found = await driveFindFolder(accessToken, name, parentDriveFolderId);
  const folder = found || (await driveCreateFolder(accessToken, name, parentDriveFolderId));
  const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
  const record = {
    id: `drivefolder_${randomUUID()}`,
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    subfolder_key: subfolderKey,
    drive_folder_id: folder.id,
    drive_folder_url: folderUrl
  };
  const { data: inserted, error } = await supabase
    .from("drive_folders")
    .upsert(record, { onConflict: "company_id,entity_type,entity_id,subfolder_key" })
    .select()
    .single();
  if (error) throw error;
  return inserted;
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

  const { company_id: companyId, entity_type: entityType, entity_id: entityId } = req.body || {};
  if (!companyId || !entityId || (entityType !== "client" && entityType !== "job")) {
    res.status(400).json({ error: "Missing or invalid company_id/entity_type/entity_id." });
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

    const accessToken = await getAccessToken(supabase, companyId);

    const { data: company, error: companyError } = await supabase.from("companies").select("name").eq("id", companyId).single();
    if (companyError || !company) throw new Error("Company not found.");

    const root = await ensureFolder(supabase, accessToken, companyId, "root", companyId, "", "Fialho CRM", null);
    const companyFolder = await ensureFolder(supabase, accessToken, companyId, "company", companyId, "", company.name, root.drive_folder_id);

    if (entityType === "client") {
      const { data: customer, error: customerError } = await supabase.from("customers").select("name").eq("id", entityId).eq("company_id", companyId).single();
      if (customerError || !customer) throw new Error("Client not found.");
      const clientFolder = await ensureFolder(supabase, accessToken, companyId, "client", entityId, "", customer.name, companyFolder.drive_folder_id);
      await supabase.from("customers").update({ drive_folder_url: clientFolder.drive_folder_url }).eq("id", entityId).eq("company_id", companyId);
      res.status(200).json({ folder_url: clientFolder.drive_folder_url });
      return;
    }

    // entityType === "job"
    const { data: job, error: jobError } = await supabase.from("jobs").select("title, customer_id").eq("id", entityId).eq("company_id", companyId).single();
    if (jobError || !job) throw new Error("Job not found.");

    let parentForProject = companyFolder.drive_folder_id;
    if (job.customer_id) {
      const { data: customer } = await supabase.from("customers").select("name, drive_folder_url").eq("id", job.customer_id).eq("company_id", companyId).maybeSingle();
      if (customer) {
        const clientFolder = await ensureFolder(supabase, accessToken, companyId, "client", job.customer_id, "", customer.name, companyFolder.drive_folder_id);
        parentForProject = clientFolder.drive_folder_id;
        if (!customer.drive_folder_url) {
          await supabase.from("customers").update({ drive_folder_url: clientFolder.drive_folder_url }).eq("id", job.customer_id).eq("company_id", companyId);
        }
      }
    }

    const projectFolder = await ensureFolder(supabase, accessToken, companyId, "job", entityId, "", job.title || "Untitled project", parentForProject);
    const subfolders = {};
    for (const name of PROJECT_SUBFOLDERS) {
      const sub = await ensureFolder(supabase, accessToken, companyId, "job", entityId, name, name, projectFolder.drive_folder_id);
      subfolders[name] = sub.drive_folder_url;
    }
    await supabase.from("jobs").update({ drive_folder_url: projectFolder.drive_folder_url }).eq("id", entityId).eq("company_id", companyId);
    res.status(200).json({ folder_url: projectFolder.drive_folder_url, subfolders });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
