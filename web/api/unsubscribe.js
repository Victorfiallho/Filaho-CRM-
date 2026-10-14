// One-click email unsubscribe at /u/<token> (from createUnsubscribeToken in
// _lib/unsubscribeToken.js). The sender puts the link in the footer and in
// the List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058).
//
//   GET   a page with one button. Never unsubscribes by itself, because mail
//         scanners open every link in a message.
//   POST  unsubscribes: the button, or a mail client's RFC 8058 one-click
//         POST. Idempotent.
//
// Unsubscribing calls revoke_marketing_consent(): global suppression plus a
// granted=false consent record for every client with that email.
import { createClient } from "@supabase/supabase-js";
import { renderMessagePage } from "./_lib/bookingHtml.js";
import { query, sendHtml } from "./_lib/http.js";
import { verifyUnsubscribeToken } from "./_lib/unsubscribeToken.js";

const HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).end();
    return;
  }
  const token = String(query(req).get("token") || "");
  const target = verifyUnsubscribeToken(token, process.env.UNSUBSCRIBE_SECRET);
  if (!target) {
    sendHtml(res, 400, renderMessagePage({ title: "Link not valid", message: "This unsubscribe link is invalid or incomplete. Reply to the email you received and we'll remove you by hand." }), HEADERS);
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: page } = target.companyId
    ? await supabase.from("booking_pages").select("business_name, primary_color").eq("company_id", target.companyId).maybeSingle()
    : { data: null };

  if (req.method === "GET") {
    const form = `<form method="post" action="/u/${encodeURIComponent(token)}"><button class="btn" type="submit">Unsubscribe</button></form>`;
    sendHtml(res, 200, renderMessagePage({ page, title: "Unsubscribe from marketing emails", message: `Click the button to stop marketing emails to ${target.email}. You'll still get emails about appointments you book.`, form }), HEADERS);
    return;
  }

  const { error } = await supabase.rpc("revoke_marketing_consent", {
    p_channel: "email",
    p_value: target.email,
    p_reason: "unsubscribe",
    p_source: "unsubscribe",
    p_text: "Clicked the one-click unsubscribe link in a marketing email.",
    p_company_id: target.companyId
  });
  if (error) {
    console.error("unsubscribe failed", error);
    sendHtml(res, 500, renderMessagePage({ page, title: "Something went wrong", message: "We couldn't process your request. Please try again, or reply to the email and we'll remove you by hand." }), HEADERS);
    return;
  }
  sendHtml(res, 200, renderMessagePage({ page, title: "You're unsubscribed", message: `${target.email} won't receive marketing emails from us anymore.` }), HEADERS);
}
