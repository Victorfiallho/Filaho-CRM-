// Vercel serverless function (web/api/* is Vercel's zero-config function
// folder for this project's Root Directory). Google redirects the browser
// here after the user grants Calendar access from Integrations.tsx's
// startCalendarOAuth() (via web/api/google-oauth-start.js, which mints the
// signed `state` this handler verifies below). Exchanges the auth code for a
// refresh token — the piece the old sessionStorage-only popup flow
// (lib/googleOAuth.ts) never got — and stores it so scripts/sync-google-
// calendar.mjs can mint fresh access on its own later, without anyone having
// the CRM tab open.
//
// SECURITY (2026-08-26 fix): `state` used to be the plain, unsigned
// company_id, and this handler had no way to tell a legitimate request from
// an attacker who crafted their own `state=<victim_company_id>` and
// completed Google consent with their own account — which would silently
// overwrite the victim company's stored refresh token via the service_role
// upsert below (a real cross-tenant Calendar-hijack channel, confirmed in a
// security audit). `state` is now an HMAC-signed, short-lived payload minted
// only by google-oauth-start.js after verifying the caller's session and
// company membership; verifyState() below rejects anything else, and
// membership is re-checked here too as defense in depth against membership
// changing between issuance and completion.
//
// Needs four env vars set in the Vercel project (not VITE_-prefixed, so they
// never ship to the client bundle): GOOGLE_CLIENT_SECRET, SUPABASE_URL,
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
    // Defense in depth: re-verify the signed state's membership claim is
    // still true right now, not just at issuance a few minutes ago.
    const stillMember = await supabase(`company_members?user_id=eq.${payload.userId}&company_id=eq.${companyId}&select=user_id`).then(r => r.json());
    if (!stillMember.length) throw new Error("Company membership changed since this connection request was started.");

    const settingsRow = await supabase("integration_settings?id=eq.default&select=settings").then(r => r.json());
    const clientId = settingsRow?.[0]?.settings?.google_oauth?.client_id;
    if (!clientId) throw new Error("No Google OAuth client_id configured yet — import the OAuth JSON in Integrations first.");

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
      // Google only issues a refresh_token on first consent (or a forced
      // re-consent). startCalendarOAuth() always sends prompt=consent, so
      // this should be rare — but if it happens and there's nothing stored
      // yet, surface it instead of silently leaving the company disconnected.
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
