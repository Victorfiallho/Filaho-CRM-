// Google redirects here after a company grants Calendar/Drive access (the
// flow starts in google-oauth-start.js). Exchanges the code for a refresh
// token and stores it, so the background scripts work without the CRM open.
//
// `state` must be the HMAC-signed, short-lived value google-oauth-start.js
// issued; anything else is rejected, or anyone could attach their own Google
// account to another company.
//
// Env (server only): GOOGLE_CLIENT_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, OAUTH_STATE_SECRET.
import { createHmac, timingSafeEqual } from "crypto";

const STATE_TTL_MS = 15 * 60 * 1000;

function verifyState(state, secret) {
  const [json, sig] = String(state || "").split(".");
  if (!json || !sig) return null;
  const expectedSig = createHmac("sha256", secret).update(json).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.companyId || !payload?.userId || !payload?.iat) return null;
  if (Date.now() - payload.iat > STATE_TTL_MS) return null;
  return payload;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(302, `/integrations?calendar_error=${encodeURIComponent(String(error))}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send("Missing code or state.");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const STATE_SECRET = process.env.OAUTH_STATE_SECRET;

  const payload = STATE_SECRET ? verifyState(state, STATE_SECRET) : null;
  if (!payload) {
    res.redirect(302, `/integrations?calendar_error=${encodeURIComponent("Invalid or expired connection request. Please try connecting again.")}`);
    return;
  }
  const companyId = payload.companyId;

  const supabase = (path, init = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        ...init.headers
      }
    });

  try {
    // Membership may have changed since the state was issued: check again.
    const stillMember = await supabase(`company_members?user_id=eq.${payload.userId}&company_id=eq.${companyId}&select=user_id`).then(r => r.json());
    if (!stillMember.length) throw new Error("Company membership changed since this connection request was started.");

    const settingsRow = await supabase("integration_settings?id=eq.default&select=settings").then(r => r.json());
    const clientId = settingsRow?.[0]?.settings?.google_oauth?.client_id;
    if (!clientId) throw new Error("No Google OAuth client_id configured yet. Import the OAuth JSON in Integrations first.");

    const redirectUri = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/google-oauth-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenBody.error_description || tokenBody.error || "Token exchange failed");

    if (tokenBody.refresh_token) {
      const upsertRes = await supabase("google_oauth_tokens?on_conflict=company_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{
          company_id: companyId,
          refresh_token: tokenBody.refresh_token,
          scope: tokenBody.scope || "",
          updated_at: new Date().toISOString()
        }])
      });
      if (!upsertRes.ok) throw new Error(`Failed to store refresh token: ${upsertRes.status} ${await upsertRes.text()}`);
    } else {
      // Google returns a refresh token only on first consent. We always send
      // prompt=consent, but if none comes back and none is stored, say so instead
      // of leaving the company silently disconnected.
      const existing = await supabase(`google_oauth_tokens?company_id=eq.${companyId}&select=company_id`).then(r => r.json());
      if (!existing.length) {
        throw new Error("Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions for this app and try connecting again.");
      }
    }

    res.redirect(302, "/integrations?connected=calendar");
  } catch (err) {
    res.redirect(302, `/integrations?calendar_error=${encodeURIComponent(err.message)}`);
  }
}
