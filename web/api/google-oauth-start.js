// Vercel serverless function — issues the Google Calendar OAuth authorize URL
// with a signed, short-lived `state` (added 2026-08-26 security fix). Before
// this existed, Integrations.tsx built the authorize URL itself client-side
// with `state` set to the plain, unsigned company_id — which meant
// web/api/google-oauth-callback.js had no way to tell a legitimate request
// apart from an attacker who crafted their own `state=<victim_company_id>`
// and completed consent with their own Google account. This endpoint moves
// URL construction server-side, where it can actually verify the caller is
// signed in and a real member of the target company before minting a state
// value the callback can trust.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as google-oauth-
// callback.js) plus OAUTH_STATE_SECRET (new — any long random string, used
// only to HMAC-sign `state`; never shipped to the client).
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "crypto";

const STATE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function signState(payload, secret) {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(json).digest("base64url");
  return `${json}.${sig}`;
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

  const { company_id: companyId } = req.body || {};
  if (!companyId) {
    res.status(400).json({ error: "Missing company_id." });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const STATE_SECRET = process.env.OAUTH_STATE_SECRET;
  if (!STATE_SECRET) {
    res.status(500).json({ error: "Server misconfigured: OAUTH_STATE_SECRET is not set." });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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

    const { data: settingsRow } = await supabase
      .from("integration_settings")
      .select("settings")
      .eq("id", "default")
      .maybeSingle();
    const clientId = settingsRow?.settings?.google_oauth?.client_id;
    if (!clientId) {
      res.status(400).json({ error: "Import the Google OAuth JSON in Integrations first." });
      return;
    }

    const state = signState(
      { companyId, userId: userData.user.id, nonce: randomBytes(8).toString("hex"), iat: Date.now() },
      STATE_SECRET
    );
    const redirectUri = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/google-oauth-callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: STATE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state
    });

    res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
