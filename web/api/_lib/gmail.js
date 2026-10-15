// Email through each company's own Gmail, for Messages: send from the
// connected account, and copy emails exchanged with the company's clients
// into `messages`. Uses the company's Google refresh token
// (google_oauth_tokens, server only), granted gmail.send + gmail.readonly.
import { uid } from "./messaging.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const BODY_MAX = 10000;

export const hasGmail = scope => /gmail\.send/.test(scope || "") && /gmail\.readonly/.test(scope || "");

// A fresh access token for the company, or null when Google isn't connected.
export async function googleAccess(supabase, companyId) {
  const { data: row } = await supabase.from("google_oauth_tokens")
    .select("refresh_token, scope, account_email, gmail_synced_at").eq("company_id", companyId).maybeSingle();
  if (!row?.refresh_token) return null;
  const { data: settingsRow } = await supabase.from("integration_settings").select("settings").eq("id", "default").maybeSingle();
  const clientId = settingsRow?.settings?.google_oauth?.client_id;
  if (!clientId) throw new Error("No Google OAuth client configured.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: row.refresh_token, grant_type: "refresh_token"
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || "Could not refresh the Google token.");
  return { token: body.access_token, scope: row.scope || "", accountEmail: row.account_email || "", syncedAt: row.gmail_synced_at || null };
}

async function gmail(token, path, init = {}) {
  const res = await fetch(`${GMAIL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Gmail request failed (${res.status}).`);
  return json;
}

// The connected account's address, stored the first time it's needed.
export async function accountEmail(supabase, companyId, access) {
  if (access.accountEmail) return access.accountEmail;
  const profile = await gmail(access.token, "/profile");
  const email = String(profile.emailAddress || "").toLowerCase();
  if (email) await supabase.from("google_oauth_tokens").update({ account_email: email }).eq("company_id", companyId);
  return email;
}

// Header values never carry a line break: no injected headers.
const headerSafe = v => String(v || "").replace(/[\r\n]+/g, " ").trim();
const encodeWord = v => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const b64url = buf => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function buildRaw({ fromName, fromEmail, to, subject, body }) {
  const name = headerSafe(fromName).replace(/"/g, "");
  const from = name ? `${encodeWord(`"${name}"`)} <${headerSafe(fromEmail)}>` : headerSafe(fromEmail);
  const encodedBody = Buffer.from(String(body || ""), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const lines = [
    `From: ${from}`,
    `To: ${headerSafe(to)}`,
    `Subject: ${encodeWord(headerSafe(subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody
  ];
  return b64url(Buffer.from(lines.join("\r\n"), "utf8"));
}

export async function sendGmail({ token, raw, threadId }) {
  const sent = await gmail(token, "/messages/send", { method: "POST", body: JSON.stringify(threadId ? { raw, threadId } : { raw }) });
  return { id: sent.id, threadId: sent.threadId || null };
}

export function addressOf(value) {
  const v = String(value || "");
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
}

const decode = data => Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function findPart(part, mime) {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts || []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return null;
}

// Only what the person wrote: the quoted history Gmail appends below
// "On ... wrote:" is cut, so the conversation doesn't repeat itself.
export function stripQuoted(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l, i) =>
    /^\s*>/.test(l) ||
    /^(On|Em)\s.+(wrote|escreveu):\s*$/i.test(l) ||
    (/^(On|Em)\s/i.test(l) && /(wrote|escreveu):\s*$/i.test(lines[i + 1] || "")) ||
    /^-{2,}\s*(Original Message|Mensagem original)/i.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

export function parseMessage(msg) {
  const headers = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
  const plain = findPart(msg.payload, "text/plain");
  const html = plain ? null : findPart(msg.payload, "text/html");
  const raw = plain ? decode(plain.body.data) : html ? decode(html.body.data).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : msg.snippet || "";
  return {
    id: msg.id,
    threadId: msg.threadId || null,
    from: addressOf(headers.from),
    to: String(headers.to || "").split(",").map(addressOf).filter(Boolean),
    subject: String(headers.subject || ""),
    date: Number(msg.internalDate) || Date.now(),
    text: (stripQuoted(raw) || String(msg.snippet || "")).slice(0, BODY_MAX)
  };
}

// Copies emails exchanged with the company's clients into `messages`. With
// `customer`, only that client's recent emails (opening a conversation);
// otherwise everything since the last sync (the 15-minute job).
export async function syncGmail(supabase, companyId, { customer } = {}) {
  const access = await googleAccess(supabase, companyId);
  if (!access || !hasGmail(access.scope)) return { synced: 0, connected: false };
  const account = await accountEmail(supabase, companyId, access);

  const { data: clients } = await supabase.from("customers").select("id, name, email").eq("company_id", companyId);
  const byEmail = new Map((clients || []).filter(c => c.email).map(c => [String(c.email).trim().toLowerCase(), c]));
  if (customer && !customer.email) return { synced: 0, connected: true };

  const since = access.syncedAt ? Math.floor((new Date(access.syncedAt).getTime() - 3600_000) / 1000) : Math.floor((Date.now() - 2 * 86400_000) / 1000);
  const q = customer
    ? `{from:${addressOf(customer.email)} to:${addressOf(customer.email)}} newer_than:180d`
    : `after:${since} -in:chats`;

  const ids = [];
  let pageToken = "";
  do {
    const list = await gmail(access.token, `/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    ids.push(...(list.messages || []).map(m => m.id));
    pageToken = list.nextPageToken || "";
  } while (pageToken && ids.length < 300);

  let synced = 0;
  if (ids.length) {
    const { data: known } = await supabase.from("messages").select("provider_id").eq("company_id", companyId).in("provider_id", ids);
    const knownIds = new Set((known || []).map(k => k.provider_id));
    for (const id of ids.filter(i => !knownIds.has(i))) {
      const m = parseMessage(await gmail(access.token, `/messages/${id}?format=full`));
      const outgoing = m.from === account;
      const client = outgoing ? m.to.map(a => byEmail.get(a)).find(Boolean) : byEmail.get(m.from);
      if (!client) continue;
      const msgId = uid("msg");
      const { error } = await supabase.from("messages").insert({
        id: msgId, company_id: companyId, customer_id: client.id, channel: "email", direction: outgoing ? "out" : "in",
        to_addr: outgoing ? addressOf(client.email) : account, from_addr: outgoing ? account : m.from,
        subject: m.subject.slice(0, 200), body: m.text || "(no text)", status: outgoing ? "sent" : "received",
        provider_id: m.id, provider_thread_id: m.threadId, created_at: new Date(m.date).toISOString(),
        read_at: outgoing ? new Date().toISOString() : null
      });
      if (error) {
        if (error.code === "23505") continue; // stored by a concurrent sync
        throw error;
      }
      synced++;
      // The feed only for fresh replies, not the first sync's backlog.
      if (!outgoing && access.syncedAt && Date.now() - m.date < 86400_000) {
        await supabase.from("audit_log").insert({
          company_id: companyId, user_id: null, entity: "messages", entity_id: msgId, action: "insert",
          diff: { name: client.name, channel: "email", customer_id: client.id, preview: m.text.slice(0, 80) }
        });
      }
    }
  }
  if (!customer) await supabase.from("google_oauth_tokens").update({ gmail_synced_at: new Date().toISOString() }).eq("company_id", companyId);
  return { synced, connected: true };
}
