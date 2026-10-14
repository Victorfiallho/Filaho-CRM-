// The assistant's data tools (web/api/chat-agent.js), as pure functions over
// one company's already-loaded rows. The handler loads the rows for the
// verified company only; nothing here can reach another company's data.
//
// Every record comes back with a `ref` ("lead:<id>", "client:<id>",
// "job:<id>") that the model is told to use as a link target, so names in
// answers open the record in the CRM (ChatWidget.tsx).

const MAX_ROWS = 40;

const day = ts => (ts ? String(ts).slice(0, 10) : null);
const digits = s => String(s || "").replace(/\D/g, "");
const clampLimit = n => Math.min(MAX_ROWS, Math.max(1, Number(n) || 15));

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// YYYY-MM-DD of a timestamp in the business's time zone.
export function localDay(ts, timeZone = "America/New_York") {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return day(ts);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function createContext(data, today) {
  const stageById = new Map((data.stages || []).map(s => [s.id, s]));
  const userById = new Map((data.users || []).map(u => [u.id, u.name]));
  const clientById = new Map((data.customers || []).map(c => [c.id, c]));
  const dealsByClient = new Map();
  for (const l of data.leads || []) {
    if (!l.customer_id) continue;
    if (!dealsByClient.has(l.customer_id)) dealsByClient.set(l.customer_id, []);
    dealsByClient.get(l.customer_id).push(l);
  }
  const jobsByClient = new Map();
  for (const j of data.jobs || []) {
    if (!j.customer_id) continue;
    if (!jobsByClient.has(j.customer_id)) jobsByClient.set(j.customer_id, []);
    jobsByClient.get(j.customer_id).push(j);
  }
  const stageType = l => stageById.get(l.stage_id)?.type || "open";
  return { data, today, stageById, userById, clientById, dealsByClient, jobsByClient, stageType };
}

export function leadRow(ctx, l) {
  const client = l.customer_id ? ctx.clientById.get(l.customer_id) : null;
  return {
    ref: `lead:${l.id}`,
    name: l.name,
    deal_title: l.title || null,
    client: client ? { ref: `client:${client.id}`, name: client.name } : null,
    stage: ctx.stageById.get(l.stage_id)?.name || l.stage_id,
    status: ctx.stageType(l),
    value: Number(l.value || 0),
    service: l.service_type || null,
    source: l.source || null,
    owner: ctx.userById.get(l.owner_user_id) || null,
    next_step: l.next_action || null,
    next_step_date: l.next_action_date || null,
    lost_reason: l.lost_reason || null,
    phone: l.phone || null,
    email: l.email || null,
    city: l.city || null,
    created: localDay(l.created_at),
    last_updated: localDay(l.updated_at)
  };
}

export function clientRow(ctx, c) {
  const deals = ctx.dealsByClient.get(c.id) || [];
  return {
    ref: `client:${c.id}`,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    city: c.city || null,
    status: c.status || null,
    source: c.source || null,
    deals_total: deals.length,
    deals_open: deals.filter(d => ctx.stageType(d) === "open").length,
    jobs: (ctx.jobsByClient.get(c.id) || []).length,
    created: localDay(c.created_at)
  };
}

export function jobRow(ctx, j) {
  const client = j.customer_id ? ctx.clientById.get(j.customer_id) : null;
  return {
    ref: `job:${j.id}`,
    title: j.title,
    client: client ? { ref: `client:${client.id}`, name: client.name } : j.customer_name ? { ref: null, name: j.customer_name } : null,
    status: j.status || null,
    scheduled_date: j.scheduled_date || null,
    value: Number(j.estimated_value || 0),
    service: j.service_type || null,
    city: j.city || null,
    owner: ctx.userById.get(j.owner_user_id) || null
  };
}

const textMatch = (needle, ...hay) => {
  const n = String(needle || "").trim().toLowerCase();
  if (!n) return true;
  const nd = digits(n);
  return hay.some(h => {
    const s = String(h || "").toLowerCase();
    return s.includes(n) || (nd.length >= 4 && digits(s).includes(nd));
  });
};

function page(rows, limit) {
  const n = clampLimit(limit);
  return { total: rows.length, shown: Math.min(n, rows.length), results: rows.slice(0, n) };
}

const stageMatches = (ctx, l, stage) => {
  if (!stage) return true;
  const s = String(stage).toLowerCase();
  const st = ctx.stageById.get(l.stage_id);
  return l.stage_id.toLowerCase() === s || String(st?.name || "").toLowerCase() === s;
};

export function findLeads(ctx, a = {}) {
  const { today } = ctx;
  const weekEnd = addDays(today, 7);
  let rows = (ctx.data.leads || []).filter(l =>
    textMatch(a.text, l.name, l.title, l.phone, l.email, l.service_type, l.city) &&
    stageMatches(ctx, l, a.stage) &&
    (!a.status || ctx.stageType(l) === a.status) &&
    (!a.service || textMatch(a.service, l.service_type)) &&
    (!a.source || textMatch(a.source, l.source, l.campaign_name)) &&
    (!a.owner || textMatch(a.owner, ctx.userById.get(l.owner_user_id))) &&
    (!a.client_id || l.customer_id === String(a.client_id).replace(/^client:/, "")) &&
    (!a.created_from || localDay(l.created_at) >= a.created_from) &&
    (!a.created_to || localDay(l.created_at) <= a.created_to) &&
    (a.min_value === undefined || Number(l.value || 0) >= Number(a.min_value)) &&
    (!a.next_step || (
      a.next_step === "overdue" ? (l.next_action_date && l.next_action_date < today && ctx.stageType(l) === "open")
      : a.next_step === "today" ? l.next_action_date === today
      : a.next_step === "this_week" ? (l.next_action_date && l.next_action_date >= today && l.next_action_date <= weekEnd)
      : a.next_step === "none" ? (!l.next_action && !l.next_action_date && ctx.stageType(l) === "open")
      : true
    ))
  );
  const sorters = {
    newest: (x, y) => String(y.created_at).localeCompare(String(x.created_at)),
    oldest: (x, y) => String(x.created_at).localeCompare(String(y.created_at)),
    value: (x, y) => Number(y.value || 0) - Number(x.value || 0),
    next_step: (x, y) => String(x.next_action_date || "9999").localeCompare(String(y.next_action_date || "9999")),
    stale: (x, y) => String(x.updated_at).localeCompare(String(y.updated_at))
  };
  rows = rows.sort(sorters[a.sort] || sorters.newest);
  const result = page(rows.map(l => leadRow(ctx, l)), a.limit);
  result.total_value = rows.reduce((t, l) => t + Number(l.value || 0), 0);
  return result;
}

export function findClients(ctx, a = {}) {
  let rows = (ctx.data.customers || []).filter(c =>
    textMatch(a.text, c.name, c.phone, c.email, c.city, c.address) &&
    (!a.status || c.status === a.status) &&
    (!a.city || textMatch(a.city, c.city)) &&
    (!a.source || textMatch(a.source, c.source))
  ).map(c => clientRow(ctx, c))
    .filter(c => (a.min_deals === undefined || c.deals_total >= Number(a.min_deals)) && (a.min_open_deals === undefined || c.deals_open >= Number(a.min_open_deals)));
  const sorters = {
    newest: (x, y) => String(y.created).localeCompare(String(x.created)),
    name: (x, y) => x.name.localeCompare(y.name),
    most_deals: (x, y) => y.deals_total - x.deals_total || y.deals_open - x.deals_open
  };
  rows = rows.sort(sorters[a.sort] || (a.min_deals !== undefined || a.min_open_deals !== undefined ? sorters.most_deals : sorters.newest));
  const result = page(rows, a.limit);
  // Deals listed for the clients shown when the question is about deals.
  if (a.min_deals !== undefined || a.min_open_deals !== undefined || a.include_deals) {
    result.results = result.results.map(c => ({
      ...c,
      deals: (ctx.dealsByClient.get(c.ref.slice(7)) || []).map(l => {
        const r = leadRow(ctx, l);
        return { ref: r.ref, deal_title: r.deal_title, service: r.service, stage: r.stage, status: r.status, value: r.value, created: r.created };
      })
    }));
  }
  return result;
}

export function findJobs(ctx, a = {}) {
  const { today } = ctx;
  let rows = (ctx.data.jobs || []).filter(j =>
    textMatch(a.text, j.title, j.customer_name, ctx.clientById.get(j.customer_id)?.name, j.city, j.service_type) &&
    (!a.status || j.status === a.status) &&
    (!a.client_id || j.customer_id === String(a.client_id).replace(/^client:/, "")) &&
    (!a.scheduled_from || (j.scheduled_date && j.scheduled_date >= a.scheduled_from)) &&
    (!a.scheduled_to || (j.scheduled_date && j.scheduled_date <= a.scheduled_to)) &&
    (a.unscheduled === undefined || Boolean(a.unscheduled) === !j.scheduled_date) &&
    (!a.upcoming || (j.scheduled_date && j.scheduled_date >= today && j.status !== "complete"))
  );
  const sorters = {
    scheduled: (x, y) => String(x.scheduled_date || "9999").localeCompare(String(y.scheduled_date || "9999")),
    newest: (x, y) => String(y.created_at).localeCompare(String(x.created_at)),
    value: (x, y) => Number(y.estimated_value || 0) - Number(x.estimated_value || 0)
  };
  rows = rows.sort(sorters[a.sort] || (a.upcoming || a.scheduled_from ? sorters.scheduled : sorters.newest));
  const result = page(rows.map(j => jobRow(ctx, j)), a.limit);
  result.total_value = rows.reduce((t, j) => t + Number(j.estimated_value || 0), 0);
  return result;
}

// "What do I have today?" in one call.
export function getToday(ctx) {
  const { today } = ctx;
  const weekEnd = addDays(today, 7);
  const leads = ctx.data.leads || [];
  const open = leads.filter(l => ctx.stageType(l) === "open");
  const jobs = ctx.data.jobs || [];
  return {
    today,
    jobs_today: jobs.filter(j => j.scheduled_date === today).map(j => jobRow(ctx, j)),
    jobs_next_7_days: jobs.filter(j => j.scheduled_date > today && j.scheduled_date <= weekEnd).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).map(j => jobRow(ctx, j)).slice(0, MAX_ROWS),
    follow_ups_today: open.filter(l => l.next_action_date === today).map(l => leadRow(ctx, l)),
    follow_ups_overdue: open.filter(l => l.next_action_date && l.next_action_date < today).sort((a, b) => a.next_action_date.localeCompare(b.next_action_date)).map(l => leadRow(ctx, l)).slice(0, MAX_ROWS),
    new_leads_today: leads.filter(l => localDay(l.created_at) === today).map(l => leadRow(ctx, l)),
    open_deals_without_next_step: open.filter(l => !l.next_action && !l.next_action_date).length,
    open_deals: open.length,
    open_pipeline_value: open.reduce((t, l) => t + Number(l.value || 0), 0)
  };
}

export function getOverview(ctx) {
  const leads = ctx.data.leads || [];
  const jobs = ctx.data.jobs || [];
  const byStatus = s => leads.filter(l => ctx.stageType(l) === s);
  return {
    clients: (ctx.data.customers || []).length,
    deals: { total: leads.length, open: byStatus("open").length, won: byStatus("won").length, lost: byStatus("lost").length },
    open_pipeline_value: byStatus("open").reduce((t, l) => t + Number(l.value || 0), 0),
    won_value: byStatus("won").reduce((t, l) => t + Number(l.value || 0), 0),
    jobs: Object.fromEntries(["planned", "scheduled", "in progress", "complete"].map(s => [s, jobs.filter(j => (j.status || "planned") === s).length])),
    completed_jobs_value: jobs.filter(j => j.status === "complete").reduce((t, j) => t + Number(j.estimated_value || 0), 0),
    services_offered: ctx.data.services || []
  };
}

// One record with what surrounds it. `notes` are passed in by the handler.
export function getRecord(ctx, ref, notes = []) {
  const [type, id] = String(ref || "").split(":");
  const noteRows = notes.slice(0, 8).map(n => ({ date: localDay(n.created_at), by: ctx.userById.get(n.user_id) || null, text: String(n.body || "").slice(0, 600) }));
  if (type === "lead") {
    const l = (ctx.data.leads || []).find(x => x.id === id);
    if (!l) return { error: "Deal not found." };
    const job = (ctx.data.jobs || []).find(j => j.lead_id === l.id);
    return { deal: leadRow(ctx, l), address: [l.address, l.city, l.state, l.zip].filter(Boolean).join(", ") || null, campaign: l.campaign_name || null, job: job ? jobRow(ctx, job) : null, notes: noteRows };
  }
  if (type === "client") {
    const c = ctx.clientById.get(id);
    if (!c) return { error: "Client not found." };
    return {
      client: clientRow(ctx, c),
      address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ") || null,
      client_notes: c.notes ? String(c.notes).slice(0, 600) : null,
      deals: (ctx.dealsByClient.get(c.id) || []).map(l => leadRow(ctx, l)),
      jobs: (ctx.jobsByClient.get(c.id) || []).map(j => jobRow(ctx, j)),
      notes: noteRows
    };
  }
  if (type === "job") {
    const j = (ctx.data.jobs || []).find(x => x.id === id);
    if (!j) return { error: "Job not found." };
    return { job: jobRow(ctx, j), address: [j.address, j.city, j.state, j.zip].filter(Boolean).join(", ") || null, job_notes: j.notes ? String(j.notes).slice(0, 600) : null, notes: noteRows };
  }
  return { error: "Use a ref like lead:<id>, client:<id> or job:<id>." };
}
