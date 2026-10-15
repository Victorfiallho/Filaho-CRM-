// Leads pushed in by automation tools (Zapier/Make "Facebook Lead Ads",
// website forms):
//
//   POST /api/lead-intake?company=<company id>&key=<LEAD_INTAKE_SECRET>
//
// Form or JSON body, field names per _lib/leadIntake.js. The person is
// matched to an existing client by phone or email (else a new client), and
// gets a deal in the first stage tagged with the Meta campaign, so Reports'
// campaign ROI fills itself. A client who already has a deal for that
// service gets no second one (one deal per service). Extra form answers are
// saved as a note on the deal. The insert lands in the activity feed through
// the leads audit trigger.
//
// No consent records: a lead form isn't SMS/email marketing consent.
// Without LEAD_INTAKE_SECRET every request is refused.
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { findClient, intakeStage, leadIsUsable, matchService, parseLeadPayload } from "./_lib/leadIntake.js";
import { query, readForm } from "./_lib/http.js";

const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function secretMatches(given) {
  const expected = process.env.LEAD_INTAKE_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const params = query(req);
  if (!secretMatches(params.get("key") || req.headers["x-intake-secret"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let lead;
  try {
    lead = parseLeadPayload(await readForm(req));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Could not read the request body." });
    return;
  }
  if (!leadIsUsable(lead)) {
    res.status(422).json({ error: "A lead needs a name and a valid US phone or an email." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const companyId = String(params.get("company") || "");
  try {
    const [company, stages, services, clients] = await Promise.all([
      supabase.from("companies").select("id").eq("id", companyId).maybeSingle(),
      supabase.from("pipeline_stages").select("id, order, type").eq("company_id", companyId),
      supabase.from("company_services").select("service, position").eq("company_id", companyId).order("position"),
      supabase.from("customers").select("id, name, phone, phone_e164, email, service_type").eq("company_id", companyId)
    ]);
    for (const r of [company, stages, services, clients]) if (r.error) throw r.error;
    if (!company.data) {
      res.status(404).json({ error: "Unknown company." });
      return;
    }

    const serviceNames = (services.data || []).map(s => s.service);
    const service = matchService(lead.service, serviceNames);
    if (lead.service && !service) lead.notes = [`Service asked: ${lead.service}`, lead.notes].filter(Boolean).join("\n");

    let client = findClient(clients.data || [], lead);
    const existingClient = Boolean(client);
    if (!client) {
      const { data, error } = await supabase.from("customers").insert({
        id: uid("cust"), company_id: companyId, name: lead.name, phone: lead.phone, phone_e164: lead.phone_e164, email: lead.email,
        address: lead.address, city: lead.city, state: lead.state, zip: lead.zip,
        status: "active", service_type: service, source: lead.source, notes: ""
      }).select("id, service_type").single();
      if (error) throw error;
      client = data;
    }

    const dealService = service || client.service_type || "";
    const { data: existingDeal, error: dealError } = await supabase.from("leads").select("id")
      .eq("company_id", companyId).eq("customer_id", client.id).eq("service_type", dealService).limit(1).maybeSingle();
    if (dealError) throw dealError;
    if (existingDeal) {
      if (lead.notes) await addNote(supabase, companyId, existingDeal.id, lead.notes);
      res.status(200).json({ ok: true, customer_id: client.id, lead_id: existingDeal.id, existing_client: existingClient, new_deal: false });
      return;
    }

    // Contact fields are copied from the client by leads_copy_client_contact.
    const leadId = uid("lead");
    const { error: insertError } = await supabase.from("leads").insert({
      id: leadId, company_id: companyId, customer_id: client.id, name: lead.name, stage_id: intakeStage(stages.data || []),
      service_type: dealService, value: 0, source: lead.source, campaign_id: lead.campaign_id, campaign_name: lead.campaign_name,
      next_action: "First contact", next_action_date: new Date().toISOString().slice(0, 10)
    });
    if (insertError) throw insertError;
    if (lead.notes) await addNote(supabase, companyId, leadId, lead.notes);

    res.status(201).json({ ok: true, customer_id: client.id, lead_id: leadId, existing_client: existingClient, new_deal: true });
  } catch (err) {
    // A 500 makes Zapier/Make retry, which a lost lead needs.
    console.error("lead-intake failed", err);
    res.status(500).json({ error: "Could not save the lead." });
  }
}

async function addNote(supabase, companyId, leadId, body) {
  const { error } = await supabase.from("notes").insert({
    id: uid("note"), company_id: companyId, entity_type: "lead", entity_id: leadId, body: body.slice(0, 4000), user_id: null
  });
  if (error) console.error("lead-intake note failed", error);
}
