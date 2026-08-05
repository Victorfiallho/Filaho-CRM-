const DB_KEY = "fialho_crm_mvp_v1";

const COMPANIES = [
  { id:"peach_fresh", name:"Peach Fresh Cleaning", slug:"peach-fresh-cleaning", logo:"PF", color:"#f36f45", accent:"#0f766e", industry:"Cleaning" },
  { id:"wish_cabinets", name:"Wish Cabinets", slug:"wish-cabinets", logo:"WC", color:"#315c7c", accent:"#d39d48", industry:"Cabinets" },
  { id:"peach_state_flooring", name:"Peach State Flooring", slug:"peach-state-flooring", logo:"PS", color:"#b95f2f", accent:"#2f6fed", industry:"Flooring" },
  { id:"arca_cabinets", name:"Arca Cabinets", slug:"arca-cabinets", logo:"AC", color:"#334155", accent:"#14a38b", industry:"Cabinets" }
];

const COMPANY_ICONS = {
  peach_fresh:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`,
  wish_cabinets:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
  peach_state_flooring:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="m12.83 2.18-8.58 3.9a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83l-8.58-3.91a2 2 0 0 0-1.66 0Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
  arca_cabinets:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`
};

const DEFAULT_USER = {
  id:"u_owner",
  name:"Pedro Fialho",
  email:"admin@fialho.local",
  role:"owner",
  company_ids: COMPANIES.map(c => c.id),
  permissions:["view","create","edit","import","export"]
};

const MODULES = [
  ["dashboard","Dashboard"],
  ["pipeline","Pipeline"],
  ["customers","Clients"],
  ["jobs","Jobs"],
  ["calendar","Calendar"],
  ["map","Map & Routes"],
  ["import","Import Center"],
  ["integrations","Integrations"],
  ["reports","Reports"]
];

const IMPORT_FIELDS = [
  ["name","Name"],["phone","Phone"],["email","Email"],["address","Address"],
  ["city","City"],["state","State"],["zip","ZIP"],["service_type","Service type"],
  ["status","Status"],["stage_id","Pipeline stage"],["value","Estimated value"],["scheduled_date","Date"],
  ["notes","Notes"],["drive_folder_url","Drive folder URL"],["lat","Latitude"],["lng","Longitude"]
];

const IMPORT_PRESETS = {
  csv:{ label:"CSV upload", aliases:{} },
  sheets:{ label:"Google Sheets CSV", aliases:{} },
  calendar:{ label:"Google Calendar CSV", aliases:{ name:["summary","subject","title"], scheduled_date:["start date","date"], address:["location","where"] } },
  calendar_ics:{ label:"Google Calendar ICS", aliases:{} },
  manual:{ label:"Manual list", aliases:{} }
};

let db = null;
let session = null;
let route = "dashboard";
let activeCompanyId = null;
let searchText = "";
let importState = { type:"csv", fileName:"", headers:[], rows:[], mapping:{}, preview:[], recordType:"customer" };
let mapFilters = { zip:"", city:"", service_type:"all", lead_status:"all", job_status:"all", date:"" };
let calendarDate = new Date();
let mapsRuntime = { key:"", promise:null, instance:null, markers:[] };
let navIndicatorPos = { top:0, height:0 };

const $ = sel => document.querySelector(sel);
const money = n => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const norm = v => String(v || "").trim();
const normKey = v => norm(v).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const normPhone = v => norm(v).replace(/\D/g,"").slice(-10);
const normEmail = v => norm(v).toLowerCase();
const normAddress = v => norm(v).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const normZip = v => (norm(v).match(/\d{5}/) || [""])[0];
const normName = v => norm(v).toLowerCase().replace(/[^a-z ]+/g," ").replace(/\s+/g," ").trim();

function seedDb(){
  const stages = {};
  const services = {};
  COMPANIES.forEach(company => {
    stages[company.id] = [
      { id:"new", company_id:company.id, name:"New", order:1, color:"#667085", type:"lead" },
      { id:"contacted", company_id:company.id, name:"Contacted", order:2, color:"#2f6fed", type:"lead" },
      { id:"estimate", company_id:company.id, name:"Estimate Sent", order:3, color:"#d89416", type:"lead" },
      { id:"scheduled", company_id:company.id, name:"Scheduled", order:4, color:"#14a38b", type:"lead" },
      { id:"won", company_id:company.id, name:"Won", order:5, color:"#1f9d64", type:"lead" }
    ];
    services[company.id] = serviceDefaults(company);
  });
  return {
    version:1,
    session:null,
    companies:COMPANIES,
    users:[DEFAULT_USER],
    stages,
    services,
    customers:[],
    leads:[],
    jobs:[],
    imports:[],
    notes:[],
    files:[],
    integration_placeholders:{
      google_maps:{ status:"planned", required_fields:["address","city","state","zip"] },
      google_calendar:{ status:"planned", required_fields:["company_id","job_id","scheduled_date"] },
      google_sheets:{ status:"planned", required_fields:["company_id","import_id"] },
      google_drive:{ status:"planned", required_fields:["company_id","customer_id","job_id","drive_folder_url"] },
      email_sms:{ status:"planned", templates:["new lead follow-up","estimate sent","appointment confirmation","appointment reminder","review request","promotion campaign","recurring customer follow-up"] },
      meta_ads:{ status:"planned", required_fields:["company_id","lead_source","campaign_id"] }
    },
    integration_settings:{
      google_oauth:{ enabled:false, client_id:"", project_id:"", javascript_origins:[], scopes:"", connected_at:"", granted_scopes:"", notes:"Import a Google OAuth web client JSON. The client_secret is never stored." },
      google_maps:{ enabled:false, api_key:"", notes:"Ready for API key, geocoding, routes, and map embeds." },
      google_calendar:{ enabled:false, calendar_ids:{}, notes:"Ready for OAuth and per-company calendar sync." },
      google_sheets:{ enabled:false, spreadsheet_ids:{}, notes:"Ready for import/export sync.", source_urls:{} },
      google_drive:{ enabled:false, folder_ids:{}, folder_urls:{}, notes:"Ready for project folders and file linking." }
    }
  };
}

function serviceDefaults(company){
  if(company.industry === "Cleaning") return ["Deep Cleaning","Recurring Cleaning","Move-in/Move-out","Commercial Cleaning"];
  if(company.industry === "Flooring") return ["Floor Installation","Floor Refinishing","Carpet","Tile"];
  return ["Kitchen Cabinets","Bathroom Vanities","Refacing","Custom Build"];
}

const FialhoDB = {
  load(){
    const raw = localStorage.getItem(DB_KEY);
    db = raw ? JSON.parse(raw) : seedDb();
    migrateDb();
    session = db.session;
    if(session?.company_id) activeCompanyId = session.company_id;
  },
  save(){
    db.session = session;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  },
  byCompany(table){
    return (db[table] || []).filter(row => row.company_id === activeCompanyId);
  },
  insert(table,row){
    db[table].push(row);
    this.save();
    return row;
  },
  update(table,id,patch){
    const row = db[table].find(item => item.id === id && item.company_id === activeCompanyId);
    if(!row) return null;
    Object.assign(row, patch, { updated_at:now() });
    this.save();
    return row;
  }
};

function migrateDb(){
  const fresh = seedDb();
  db.integration_placeholders = db.integration_placeholders || fresh.integration_placeholders;
  db.integration_settings = db.integration_settings || fresh.integration_settings;
  Object.keys(fresh.integration_settings).forEach(key => {
    db.integration_settings[key] = { ...fresh.integration_settings[key], ...(db.integration_settings[key] || {}) };
  });
  COMPANIES.forEach(company => {
    db.stages[company.id] = db.stages[company.id] || fresh.stages[company.id];
    db.services[company.id] = db.services[company.id] || fresh.services[company.id];
  });
  ensureLeadClients();
}

function ensureLeadClients(){
  let changed = false;
  (db.leads || []).forEach(lead => {
    const linked = lead.customer_id && (db.customers || []).some(client => client.id === lead.customer_id && client.company_id === lead.company_id);
    if(linked) return;
    const client = upsertClientFromLeadRecord(lead, lead.company_id);
    if(client?.id && lead.customer_id !== client.id){
      lead.customer_id = client.id;
      lead.updated_at = now();
      changed = true;
    }
  });
  if(changed) localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function app(){
  FialhoDB.load();
  if(!session) return renderLogin();
  if(!activeCompanyId) return renderCompanyPicker();
  renderShell();
}

function renderLogin(){
  $("#app").innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="mark">FC</div>
        <h1>Fialho CRM</h1>
        <p class="sub">Sprint 1 MVP for multi-company CRM operations.</p>
        <div class="field"><label>Email</label><input id="loginEmail" value="${DEFAULT_USER.email}"></div>
        <div class="field"><label>Password</label><input id="loginPassword" type="password" value="demo123"></div>
        <button class="btn" style="width:100%;margin-top:18px" onclick="login()">Login</button>
        <p class="sub" style="margin-top:12px">Demo login only. Production auth is prepared for a later sprint.</p>
      </section>
    </main>`;
}

function login(){
  const email = $("#loginEmail").value.trim().toLowerCase();
  const user = db.users.find(u => u.email.toLowerCase() === email) || DEFAULT_USER;
  session = { user_id:user.id, company_id:null, logged_in_at:now() };
  FialhoDB.save();
  renderCompanyPicker();
}

function logout(){
  session = null;
  activeCompanyId = null;
  FialhoDB.save();
  renderLogin();
}

function renderCompanyPicker(){
  $("#app").innerHTML = `
    <main class="company-pick">
      <section class="company-panel">
        <div class="between">
          <div>
            <h1>Select company</h1>
            <p class="sub">All records, imports, dashboards, and jobs stay separated by company.</p>
          </div>
          <button class="btn ghost" onclick="logout()">Logout</button>
        </div>
        <div class="company-grid">
          ${COMPANIES.map(c => `
            <button class="company-card" data-company="${c.id}" style="--company-color:${c.color}" onclick="selectCompany('${c.id}')">
              <div class="logo">${COMPANY_ICONS[c.id] || c.logo}</div>
              <h3 style="margin-top:14px">${c.name}</h3>
              <p class="sub">${c.industry} workspace</p>
            </button>`).join("")}
        </div>
      </section>
    </main>`;
}

function selectCompany(id){
  activeCompanyId = id;
  session.company_id = id;
  route = "dashboard";
  FialhoDB.save();
  renderShell();
}

function company(){ return COMPANIES.find(c => c.id === activeCompanyId); }
function stages(){ return db.stages[activeCompanyId] || []; }
function services(){ return db.services[activeCompanyId] || []; }

function renderShell(){
  const c = company();
  $("#app").style.setProperty("--company-color", c.color);
  $("#app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="logo" data-company="${c.id}">${COMPANY_ICONS[c.id] || c.logo}</div>
          <div><b>Fialho CRM</b><span>${c.name}</span></div>
        </div>
        <nav class="nav">
          <span class="nav-indicator" id="navIndicator" style="transform:translateY(${navIndicatorPos.top}px);height:${navIndicatorPos.height}px"></span>
          ${MODULES.map(([id,label]) => `<button class="${route===id?"active":""}" onclick="go('${id}')">${label}</button>`).join("")}
        </nav>
        <div class="side-foot">
          <button class="btn ghost slim" onclick="activeCompanyId=null;session.company_id=null;FialhoDB.save();renderCompanyPicker()">Switch company</button>
          <button class="btn ghost slim" style="margin-top:8px" onclick="logout()">Logout</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="hamburger" onclick="toggleSidebar()">Menu</button>
          <div>
            <h2>${pageTitle()}</h2>
            <div class="sub">${c.name}</div>
          </div>
          <div class="search"><input placeholder="Search this company..." value="${escapeAttr(searchText)}" oninput="searchText=this.value;renderCurrent()"></div>
          <button class="btn ghost" data-action="new-lead" onclick="openRecordModal('lead')">New lead</button>
          <button class="btn" data-action="new-customer" onclick="openRecordModal('customer')">New client</button>
        </header>
        <section class="content view-enter" id="view"></section>
      </main>
    </div>`;
  renderCurrent();
  positionNavIndicator();
}

function positionNavIndicator(){
  requestAnimationFrame(() => {
    const active = document.querySelector(".nav button.active");
    const indicator = $("#navIndicator");
    if(!active || !indicator) return;
    navIndicatorPos = { top:active.offsetTop, height:active.offsetHeight };
    indicator.style.transform = `translateY(${navIndicatorPos.top}px)`;
    indicator.style.height = navIndicatorPos.height + "px";
  });
}

function pageTitle(){
  return (MODULES.find(m => m[0] === route) || MODULES[0])[1];
}

function go(id){
  route = id;
  importState.preview = [];
  renderShell();
}

function toggleSidebar(){
  $("#sidebar")?.classList.toggle("open");
}

function renderCurrent(){
  const views = {
    dashboard:renderDashboard,
    pipeline:renderPipeline,
    customers:renderCustomers,
    jobs:renderJobs,
    calendar:renderCalendar,
    map:renderMapRoutes,
    import:renderImport,
    integrations:renderIntegrations,
    reports:renderReports
  };
  (views[route] || renderDashboard)();
}

function filteredRows(table){
  const q = searchText.toLowerCase().trim();
  const rows = FialhoDB.byCompany(table);
  if(!q) return rows;
  return rows.filter(row => [row.name,row.title,row.phone,row.email,row.city,row.zip,row.service_type,row.status].some(v => String(v || "").toLowerCase().includes(q)));
}

function metrics(){
  const customers = FialhoDB.byCompany("customers");
  const leads = FialhoDB.byCompany("leads");
  const jobs = FialhoDB.byCompany("jobs");
  const won = leads.filter(l => l.stage_id === "won");
  const pipelineValue = leads.filter(l => l.stage_id !== "won").reduce((t,l) => t + Number(l.value || 0),0);
  const jobValue = jobs.reduce((t,j) => t + Number(j.estimated_value || 0),0);
  return { customers, leads, jobs, won, pipelineValue, jobValue };
}

function renderDashboard(){
  const m = metrics();
  $("#view").innerHTML = `
    <div class="grid kpis">
      ${kpi("Clients",m.customers.length,"active company records")}
      ${kpi("Open leads",m.leads.filter(l => l.stage_id !== "won").length,m.won.length + " won")}
      ${kpi("Jobs/projects",m.jobs.length,"scheduled and active")}
      ${kpi("Pipeline",money(m.pipelineValue),"estimated value")}
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="card">
        <div class="card-h"><h3>Pipeline by stage</h3><span class="sub">Company only</span></div>
        <div class="card-b">${stages().map(s => stageBar(s)).join("")}</div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Sprint 1 integrations</h3><span class="sub">Prepared, not connected</span></div>
        <div class="card-b">
          ${Object.entries(db.integration_placeholders).map(([k,v]) => `<p><span class="pill">${v.status}</span> ${titleize(k)}</p>`).join("")}
        </div>
      </section>
    </div>`;
}

function kpi(label,value,hint){
  return `<section class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></section>`;
}

function stageBar(stage){
  const count = FialhoDB.byCompany("leads").filter(l => l.stage_id === stage.id).length;
  return `<div style="margin-bottom:12px">
    <div class="between"><b>${stage.name}</b><span class="pill">${count}</span></div>
    <div style="height:8px;background:#eef2f6;border-radius:999px;margin-top:7px"><div style="width:${Math.min(100,count*18)}%;height:8px;background:${stage.color};border-radius:999px"></div></div>
  </div>`;
}

function renderPipeline(){
  const leads = filteredRows("leads");
  $("#view").innerHTML = `
    <div class="pipeline">
      ${stages().map(stage => `
        <section class="stage">
          <div class="stage-h"><span>${stage.name}</span><span>${leads.filter(l => l.stage_id === stage.id).length}</span></div>
          ${leads.filter(l => l.stage_id === stage.id).map(leadCard).join("") || `<div class="empty">No leads</div>`}
        </section>`).join("")}
    </div>`;
}

function leadCard(lead){
  return `<button class="lead-card" onclick="openRecordModal('lead','${lead.id}')" style="width:calc(100% - 20px);text-align:left">
    <b>${escapeHtml(lead.name)}</b>
    <div class="sub">${escapeHtml(lead.service_type || "Service")} | ${money(lead.value)}</div>
    <div class="sub">${escapeHtml([lead.city,lead.zip].filter(Boolean).join(" "))}</div>
  </button>`;
}

function renderCustomers(){
  const rows = filteredRows("customers");
  $("#view").innerHTML = `
    <section class="card">
      <div class="card-h"><h3>Client database</h3><button class="btn slim" onclick="openRecordModal('customer')">Add client</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Contact</th><th>Location</th><th>Service</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(c => `
          <tr>
            <td><b>${escapeHtml(c.name)}</b><div class="sub">${escapeHtml(c.source || "Manual")}</div></td>
            <td>${escapeHtml(c.phone || c.email || "")}</td>
            <td>${escapeHtml([c.city,c.state,c.zip].filter(Boolean).join(" "))}</td>
            <td>${escapeHtml(c.service_type || "")}</td>
            <td><span class="pill">${escapeHtml(c.status || "active")}</span></td>
            <td><button class="btn ghost slim" onclick="openRecordModal('customer','${c.id}')">Edit</button></td>
          </tr>`).join("") || `<tr><td colspan="6"><div class="empty">No clients yet</div></td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function renderJobs(){
  const rows = filteredRows("jobs");
  $("#view").innerHTML = `
    <section class="card">
      <div class="card-h"><h3>Jobs/projects</h3><button class="btn slim" onclick="openRecordModal('job')">Add job</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Job</th><th>Status</th><th>Client</th><th>Date</th><th>Value</th><th>Drive</th><th></th></tr></thead>
        <tbody>${rows.map(j => {
          const cust = db.customers.find(c => c.id === j.customer_id);
          return `<tr>
            <td><b>${escapeHtml(j.title)}</b><div class="sub">${escapeHtml(j.service_type || "")}</div></td>
            <td><span class="pill">${escapeHtml(j.status || "planned")}</span></td>
            <td>${escapeHtml(cust?.name || "")}</td>
            <td>${escapeHtml(j.scheduled_date || "")}</td>
            <td>${money(j.estimated_value)}</td>
            <td>${j.drive_folder_url ? `<a href="${escapeAttr(j.drive_folder_url)}" target="_blank">Folder</a>` : driveRootLink("Link root")}</td>
            <td><button class="btn ghost slim" onclick="openRecordModal('job','${j.id}')">Edit</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="7"><div class="empty">No jobs yet</div></td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function renderCalendar(){
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const monthJobs = FialhoDB.byCompany("jobs").filter(job => {
    if(!job.scheduled_date) return false;
    const d = new Date(job.scheduled_date + "T00:00:00");
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const today = new Date().toISOString().slice(0,10);
  let cells = "";
  for(let i=0;i<startPad;i++) cells += `<div class="cal-cell muted"></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const date = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const jobs = monthJobs.filter(job => job.scheduled_date === date);
    cells += `<button class="cal-cell ${date===today?"today":""}" onclick="openQuickJob('${date}')">
      <span class="cal-day">${day}</span>
      ${jobs.slice(0,3).map(job => `<span class="cal-job">${escapeHtml(job.title)} · ${escapeHtml(job.status || "planned")}</span>`).join("")}
      ${jobs.length > 3 ? `<span class="cal-more">+${jobs.length - 3} more</span>` : ""}
    </button>`;
  }
  $("#view").innerHTML = `
    <div class="grid two">
      <section class="card">
        <div class="card-h">
          <div><h3>Internal job calendar</h3><span class="sub">Company events before Google sync</span></div>
          <div class="tabs">
            <button class="btn ghost slim" onclick="moveCalendar(-1)">Prev</button>
            <button class="btn ghost slim" onclick="calendarDate=new Date();renderCalendar()">Today</button>
            <button class="btn ghost slim" onclick="moveCalendar(1)">Next</button>
            <button class="btn ghost slim" onclick="downloadCompanyIcs()">Export ICS</button>
          </div>
        </div>
        <div class="card-b">
          <h3>${calendarDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</h3>
          <div class="calendar-grid">
            ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => `<div class="cal-head">${d}</div>`).join("")}
            ${cells}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Upcoming jobs</h3><button class="btn slim" onclick="openRecordModal('job')">Add job</button></div>
        <div class="card-b">
          ${FialhoDB.byCompany("jobs").filter(j => j.scheduled_date).sort((a,b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0,10).map(job => `
            <div class="route-stop">
              <b>${escapeHtml(job.scheduled_date)} · ${escapeHtml(job.title)}</b>
              <span>${escapeHtml([job.city,job.zip,job.service_type].filter(Boolean).join(" | "))}</span>
              <a href="${escapeAttr(googleCalendarCreateUrl(job))}" target="_blank">Open in Google Calendar</a>
            </div>`).join("") || `<div class="empty">No scheduled jobs yet</div>`}
        </div>
      </section>
    </div>`;
}

function moveCalendar(delta){
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta, 1);
  renderCalendar();
}

function openQuickJob(date){
  openRecordModal("job");
  setTimeout(() => {
    const field = $("#f_scheduled_date");
    if(field) field.value = date;
  },0);
}

function googleCalendarCreateUrl(job){
  const start = calendarDateString(job.scheduled_date || new Date().toISOString().slice(0,10));
  const endDate = new Date((job.scheduled_date || new Date().toISOString().slice(0,10)) + "T00:00:00");
  endDate.setDate(endDate.getDate() + 1);
  const end = calendarDateString(endDate.toISOString().slice(0,10));
  const text = encodeURIComponent(`${company().name}: ${job.title}`);
  const location = encodeURIComponent([job.address,job.city,job.state,job.zip].filter(Boolean).join(", "));
  const details = encodeURIComponent(`Service: ${job.service_type || ""}\nStatus: ${job.status || ""}\nCRM job id: ${job.id}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&location=${location}&details=${details}`;
}

function calendarDateString(date){
  return String(date || "").replace(/-/g,"");
}

function downloadCompanyIcs(){
  const jobs = FialhoDB.byCompany("jobs").filter(j => j.scheduled_date);
  if(!jobs.length){ toast("No scheduled jobs to export."); return; }
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Fialho CRM//EN"];
  jobs.forEach(job => {
    const start = calendarDateString(job.scheduled_date);
    const endDate = new Date(job.scheduled_date + "T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${job.id}@fialho-crm`,
      `DTSTAMP:${calendarDateString(new Date().toISOString().slice(0,10))}T120000Z`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${calendarDateString(endDate.toISOString().slice(0,10))}`,
      `SUMMARY:${icsText(company().name + ": " + job.title)}`,
      `LOCATION:${icsText([job.address,job.city,job.state,job.zip].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsText(`Service: ${job.service_type || ""}\\nStatus: ${job.status || ""}\\nCRM job id: ${job.id}`)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  downloadText(`${company().slug}-jobs.ics`, lines.join("\r\n"), "text/calendar");
}

function icsText(value){
  return String(value || "").replace(/\\/g,"\\\\").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\n/g,"\\n");
}

function renderMapRoutes(){
  const rows = mapRecords();
  const filtered = rows.filter(matchesMapFilters);
  const zips = unique(rows.map(r => r.zip).filter(Boolean));
  const cities = unique(rows.map(r => r.city).filter(Boolean));
  const regionGroups = groupBy(filtered.filter(r => r.zip), r => r.zip.slice(0,3) || "Other");
  $("#view").innerHTML = `
    <div class="grid" style="grid-template-columns:1.4fr .8fr;align-items:start">
      <section class="card">
        <div class="card-h">
          <div><h3>Company map</h3><span class="sub">Visual planning map now, Google Maps API later</span></div>
          <span class="pill">${filtered.length} records</span>
        </div>
        <div class="card-b">
          ${mapFilterHtml(zips,cities)}
          <div id="googleMap" class="google-map"></div>
          <div id="fallbackMap" class="map-canvas">
            ${filtered.map((record,index) => mapPin(record,index)).join("")}
            ${filtered.length ? "" : `<div class="map-empty">No matching clients, leads, or jobs</div>`}
          </div>
          <div class="between" style="margin-top:10px;flex-wrap:wrap">
            <span class="sub">${googleMapsReady() ? "Google Maps is connected for markers and map display." : "Add a Google Maps API key in Integrations to enable real Google map tiles and geocoding."}</span>
            <button class="btn ghost slim" onclick="geocodeVisibleRecords()">Geocode visible records</button>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Route regions</h3><span class="sub">Grouped by ZIP prefix</span></div>
        <div class="card-b">
          ${Object.entries(regionGroups).sort((a,b) => b[1].length - a[1].length).map(([region,items]) => `
            <div class="route-block">
              <div class="between"><b>Region ${escapeHtml(region)}xx</b><span class="pill">${items.length} stops</span></div>
              ${items.slice(0,5).map(item => `<div class="route-stop"><b>${escapeHtml(item.name || item.title)}</b><span>${escapeHtml([item.city,item.zip,item.service_type].filter(Boolean).join(" | "))}</span></div>`).join("")}
            </div>`).join("") || `<div class="empty">No route groups yet</div>`}
        </div>
      </section>
    </div>`;
  setTimeout(() => renderGoogleMap(filtered), 0);
}

function mapFilterHtml(zips,cities){
  return `<div class="map-filters">
    <select onchange="mapFilters.zip=this.value;renderMapRoutes()"><option value="">All ZIP codes</option>${zips.map(zip => `<option value="${escapeAttr(zip)}" ${mapFilters.zip===zip?"selected":""}>${escapeHtml(zip)}</option>`).join("")}</select>
    <select onchange="mapFilters.city=this.value;renderMapRoutes()"><option value="">All cities</option>${cities.map(city => `<option value="${escapeAttr(city)}" ${mapFilters.city===city?"selected":""}>${escapeHtml(city)}</option>`).join("")}</select>
    <select onchange="mapFilters.service_type=this.value;renderMapRoutes()"><option value="all">All services</option>${services().map(s => `<option value="${escapeAttr(s)}" ${mapFilters.service_type===s?"selected":""}>${escapeHtml(s)}</option>`).join("")}</select>
    <select onchange="mapFilters.lead_status=this.value;renderMapRoutes()"><option value="all">All lead stages</option>${stages().map(s => `<option value="${escapeAttr(s.id)}" ${mapFilters.lead_status===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}</select>
    <select onchange="mapFilters.job_status=this.value;renderMapRoutes()"><option value="all">All job statuses</option>${["planned","scheduled","in progress","complete"].map(s => `<option value="${s}" ${mapFilters.job_status===s?"selected":""}>${titleize(s)}</option>`).join("")}</select>
    <input type="date" value="${escapeAttr(mapFilters.date)}" onchange="mapFilters.date=this.value;renderMapRoutes()">
    <button class="btn ghost slim" onclick="mapFilters={zip:'',city:'',service_type:'all',lead_status:'all',job_status:'all',date:''};renderMapRoutes()">Clear</button>
  </div>`;
}

function mapRecords(){
  return [
    ...FialhoDB.byCompany("customers").map(r => ({...r, kind:"customer"})),
    ...FialhoDB.byCompany("leads").map(r => ({...r, kind:"lead"})),
    ...FialhoDB.byCompany("jobs").map(r => ({...r, name:r.title, kind:"job"}))
  ].filter(r => r.address || r.city || r.zip);
}

function matchesMapFilters(record){
  if(mapFilters.zip && record.zip !== mapFilters.zip) return false;
  if(mapFilters.city && record.city !== mapFilters.city) return false;
  if(mapFilters.service_type !== "all" && record.service_type !== mapFilters.service_type) return false;
  if(mapFilters.lead_status !== "all" && record.kind === "lead" && record.stage_id !== mapFilters.lead_status) return false;
  if(mapFilters.job_status !== "all" && record.kind === "job" && record.status !== mapFilters.job_status) return false;
  if(mapFilters.date && record.kind === "job" && record.scheduled_date !== mapFilters.date) return false;
  if(mapFilters.date && record.kind !== "job") return false;
  return true;
}

function mapPin(record,index){
  const pos = pseudoPosition(record,index);
  const label = record.kind === "job" ? "J" : record.kind === "lead" ? "L" : "C";
  return `<button class="map-pin ${record.kind}" style="left:${pos.x}%;top:${pos.y}%" title="${escapeAttr(record.name || record.title)}" onclick="openMapRecord('${record.kind}','${record.id}')">
    <span>${label}</span>
    <small>${escapeHtml(record.zip || record.city || "")}</small>
  </button>`;
}

function googleMapsReady(){
  return Boolean(db.integration_settings?.google_maps?.api_key);
}

async function loadGoogleMaps(){
  const key = db.integration_settings?.google_maps?.api_key;
  if(!key) return null;
  if(window.google?.maps && mapsRuntime.key === key) return window.google.maps;
  if(mapsRuntime.promise && mapsRuntime.key === key) return mapsRuntime.promise;
  mapsRuntime.key = key;
  mapsRuntime.promise = new Promise((resolve,reject) => {
    const callback = "fialhoGoogleMapsReady_" + Date.now();
    window[callback] = () => {
      delete window[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return mapsRuntime.promise;
}

async function renderGoogleMap(records){
  const mapEl = $("#googleMap");
  const fallback = $("#fallbackMap");
  if(!mapEl || !fallback) return;
  if(!googleMapsReady()){
    mapEl.style.display = "none";
    fallback.style.display = "block";
    return;
  }
  try{
    const maps = await loadGoogleMaps();
    mapEl.style.display = "block";
    fallback.style.display = "none";
    const withCoords = records.filter(r => Number(r.lat) && Number(r.lng));
    const center = withCoords[0] ? { lat:Number(withCoords[0].lat), lng:Number(withCoords[0].lng) } : { lat:33.749, lng:-84.388 };
    mapsRuntime.instance = new maps.Map(mapEl, { center, zoom: withCoords.length ? 10 : 9, mapTypeControl:false, streetViewControl:false });
    mapsRuntime.markers = [];
    withCoords.forEach(record => {
      const marker = new maps.Marker({
        position:{ lat:Number(record.lat), lng:Number(record.lng) },
        map:mapsRuntime.instance,
        title:record.name || record.title || record.kind
      });
      marker.addListener("click", () => openMapRecord(record.kind,record.id));
      mapsRuntime.markers.push(marker);
    });
    if(withCoords.length > 1){
      const bounds = new maps.LatLngBounds();
      withCoords.forEach(r => bounds.extend({ lat:Number(r.lat), lng:Number(r.lng) }));
      mapsRuntime.instance.fitBounds(bounds);
    }
  }catch(error){
    mapEl.style.display = "none";
    fallback.style.display = "block";
    toast("Google Maps could not load. Check the API key.");
  }
}

async function geocodeVisibleRecords(){
  const key = db.integration_settings?.google_maps?.api_key;
  if(!key){ toast("Add a Google Maps API key first."); return; }
  const records = mapRecords().filter(matchesMapFilters).filter(r => !Number(r.lat) || !Number(r.lng));
  if(!records.length){ toast("All visible records already have coordinates."); return; }
  let updated = 0;
  for(const record of records.slice(0,25)){
    const address = [record.address,record.city,record.state,record.zip].filter(Boolean).join(", ");
    if(!address) continue;
    try{
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`);
      const data = await res.json();
      const loc = data.results?.[0]?.geometry?.location;
      if(loc){
        const table = record.kind === "job" ? "jobs" : record.kind === "lead" ? "leads" : "customers";
        FialhoDB.update(table, record.id, { lat:loc.lat, lng:loc.lng });
        updated++;
      }
    }catch(e){ /* keep trying remaining records */ }
  }
  toast(`${updated} records geocoded.`);
  renderMapRoutes();
}

function pseudoPosition(record,index){
  const seed = `${record.zip || ""}${record.city || ""}${record.address || ""}${index}`;
  let hash = 0;
  for(const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { x: 8 + (hash % 82), y: 12 + ((hash >> 8) % 72) };
}

function openMapRecord(kind,id){
  if(kind === "customer") return openRecordModal("customer",id);
  if(kind === "lead") return openRecordModal("lead",id);
  return openRecordModal("job",id);
}

function renderIntegrations(){
  const settings = db.integration_settings;
  $("#view").innerHTML = `
    ${oauthCard(settings.google_oauth)}
    <div class="grid two">
      ${integrationCard("google_maps","Google Maps","Used for geocoding, map display, filtering, and route planning.",settings.google_maps)}
      ${integrationCard("google_calendar","Google Calendar","Used for per-company job calendars and future two-way sync.",settings.google_calendar)}
      ${integrationCard("google_sheets","Google Sheets","Used for future direct sheet imports and exports.",settings.google_sheets)}
      ${integrationCard("google_drive","Google Drive","Used for client/job folders, files, and project documents.",settings.google_drive)}
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-h"><h3>Connection status</h3><span class="sub">Local CRM with optional Google OAuth</span></div>
      <div class="card-b">
        <p><b>Maps:</b> add a Maps API key for real Google map tiles, geocoding, and directions.</p>
        <p><b>Calendar:</b> ICS import/export is active. OAuth enables future live Google Calendar sync.</p>
        <p><b>Drive:</b> folder URL fields are active. OAuth enables future file picker/upload workflows.</p>
        <p><b>Sheets:</b> public/published CSV import is active. OAuth enables future private Sheet reads.</p>
      </div>
    </section>`;
}

function oauthCard(setting){
  const connected = ["basic","calendar","drive","sheets"].some(service => sessionStorage.getItem(`fialho_google_access_token_${service}`)) ? "connected this session" : setting.enabled ? "configured" : "not configured";
  return `<section class="card" style="margin-bottom:14px">
    <div class="card-h"><h3>Google OAuth</h3><span class="pill">${connected}</span></div>
    <div class="card-b">
      <p class="sub">Upload the Google Web OAuth JSON. The CRM stores the Client ID and project only; it does not store the client secret.</p>
      <div class="form-row">
        <div class="field"><label>OAuth JSON from Google Cloud</label><input type="file" accept=".json,application/json" onchange="loadGoogleOAuthJson(this.files[0])"></div>
        <div class="field"><label>OAuth Client ID</label><input value="${escapeAttr(setting.client_id || "")}" onchange="saveOAuthField('client_id',this.value)"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Project ID</label><input value="${escapeAttr(setting.project_id || "")}" onchange="saveOAuthField('project_id',this.value)"></div>
        <div class="field"><label>Granted scopes</label><input value="${escapeAttr(setting.granted_scopes || "")}" readonly></div>
      </div>
      <div class="inline-actions">
        <button class="btn ghost slim" onclick="connectGoogleWorkspace('basic')">Connect basic</button>
        <button class="btn ghost slim" onclick="connectGoogleWorkspace('calendar')">Allow Calendar</button>
        <button class="btn ghost slim" onclick="connectGoogleWorkspace('drive')">Allow Drive</button>
        <button class="btn ghost slim" onclick="connectGoogleWorkspace('sheets')">Allow Sheets</button>
        <button class="btn ghost slim" onclick="clearGoogleSession()">Disconnect session</button>
      </div>
      <p class="sub">Authorized origin needed in Google Cloud: ${escapeHtml(location.origin)}</p>
      <p class="sub"><b>Access blocked?</b> In production, Google blocks OAuth if the request includes sensitive scopes that are not listed or approved in Google Auth platform > Data Access.</p>
    </div>
  </section>`;
}

function integrationCard(key,title,description,setting){
  const companyId = activeCompanyId;
  const extra = key === "google_sheets"
    ? `<div class="field"><label>Default Google Sheet URL for ${escapeHtml(company().name)}</label><input value="${escapeAttr(setting.source_urls?.[companyId] || "")}" onchange="saveCompanyIntegrationValue('${key}','source_urls',this.value)"></div>`
    : key === "google_drive"
      ? `<div class="field"><label>Company Google Drive root folder URL</label><input value="${escapeAttr(setting.folder_urls?.[companyId] || "")}" onchange="saveCompanyIntegrationValue('${key}','folder_urls',this.value)"></div>${setting.folder_urls?.[companyId] ? `<a class="btn ghost slim" target="_blank" href="${escapeAttr(setting.folder_urls[companyId])}">Open Drive folder</a>` : ""}`
      : key === "google_calendar"
        ? `<div class="field"><label>Company Google Calendar ID</label><input value="${escapeAttr(setting.calendar_ids?.[companyId] || "")}" onchange="saveCompanyIntegrationValue('${key}','calendar_ids',this.value)"></div>`
        : "";
  return `<section class="card">
    <div class="card-h"><h3>${title}</h3><span class="pill">${setting.enabled ? "enabled" : "planned"}</span></div>
    <div class="card-b">
      <p class="sub">${description}</p>
      <div class="field"><label>API key / OAuth note</label><input value="${escapeAttr(setting.api_key || setting.notes || "")}" onchange="saveIntegrationSetting('${key}',this.value)"></div>
      ${extra}
      <button class="btn ghost slim" onclick="toggleIntegration('${key}')">${setting.enabled ? "Mark planned" : "Mark ready"}</button>
    </div>
  </section>`;
}

function saveIntegrationSetting(key,value){
  if(!db.integration_settings[key]) return;
  if(key === "google_maps") db.integration_settings[key].api_key = value;
  else db.integration_settings[key].notes = value;
  FialhoDB.save();
  toast("Integration setting saved.");
}

function toggleIntegration(key){
  if(!db.integration_settings[key]) return;
  db.integration_settings[key].enabled = !db.integration_settings[key].enabled;
  FialhoDB.save();
  renderIntegrations();
}

function saveCompanyIntegrationValue(key,field,value){
  if(!db.integration_settings[key]) return;
  db.integration_settings[key][field] = db.integration_settings[key][field] || {};
  db.integration_settings[key][field][activeCompanyId] = value;
  FialhoDB.save();
  toast("Company integration setting saved.");
}

function loadGoogleOAuthJson(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try{
      const parsed = JSON.parse(event.target.result);
      const config = parsed.web || parsed.installed || parsed;
      if(!config.client_id) throw new Error("Missing client_id");
      const oauth = db.integration_settings.google_oauth;
      oauth.client_id = config.client_id;
      oauth.project_id = config.project_id || oauth.project_id || "";
      oauth.javascript_origins = config.javascript_origins || [];
      oauth.enabled = true;
      oauth.connected_at = "";
      FialhoDB.save();
      renderIntegrations();
      toast("Google OAuth config imported. Client secret was ignored.");
    }catch(error){
      toast("Could not read that OAuth JSON.");
    }
  };
  reader.readAsText(file);
}

function saveOAuthField(field,value){
  const oauth = db.integration_settings.google_oauth;
  oauth[field] = value;
  oauth.enabled = Boolean(oauth.client_id);
  FialhoDB.save();
  toast("Google OAuth setting saved.");
}

const GOOGLE_SCOPE_PRESETS = {
  basic:"openid email profile",
  calendar:"https://www.googleapis.com/auth/calendar.events",
  drive:"https://www.googleapis.com/auth/drive.file",
  sheets:"https://www.googleapis.com/auth/spreadsheets.readonly"
};

function connectGoogleWorkspace(service="basic"){
  const oauth = db.integration_settings.google_oauth;
  if(!oauth?.client_id){ toast("Import the Google OAuth JSON first."); return; }
  const scope = GOOGLE_SCOPE_PRESETS[service] || GOOGLE_SCOPE_PRESETS.basic;
  loadGoogleIdentity().then(() => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id:oauth.client_id,
      scope,
      callback:response => {
        if(response.error){ toast("Google connection was not completed."); return; }
        sessionStorage.setItem(`fialho_google_access_token_${service}`, response.access_token);
        oauth.enabled = true;
        oauth.connected_at = now();
        oauth.granted_scopes = mergeScopes(oauth.granted_scopes, response.scope || scope);
        if(service === "calendar") db.integration_settings.google_calendar.enabled = true;
        if(service === "drive") db.integration_settings.google_drive.enabled = true;
        if(service === "sheets") db.integration_settings.google_sheets.enabled = true;
        FialhoDB.save();
        renderIntegrations();
        toast(`Google ${service} connected for this browser session.`);
      }
    });
    client.requestAccessToken({ prompt:"consent" });
  }).catch(() => toast("Could not load Google sign-in. Check internet access."));
}

function mergeScopes(existing,next){
  return Array.from(new Set(`${existing || ""} ${next || ""}`.split(/\s+/).filter(Boolean))).join(" ");
}

function loadGoogleIdentity(){
  if(window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve,reject) => {
    const existing = document.querySelector("script[data-google-identity]");
    if(existing){ existing.addEventListener("load",resolve,{ once:true }); existing.addEventListener("error",reject,{ once:true }); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function googleAccessToken(){
  return sessionStorage.getItem("fialho_google_access_token_basic") || "";
}

function clearGoogleSession(){
  ["basic","calendar","drive","sheets"].forEach(service => sessionStorage.removeItem(`fialho_google_access_token_${service}`));
  renderIntegrations();
  toast("Google session disconnected.");
}

function renderReports(){
  const m = metrics();
  const byService = {};
  FialhoDB.byCompany("leads").forEach(l => byService[l.service_type || "Unassigned"] = (byService[l.service_type || "Unassigned"] || 0) + Number(l.value || 0));
  $("#view").innerHTML = `
    <div class="grid kpis">
      ${kpi("Estimated job revenue",money(m.jobValue),"from jobs/projects")}
      ${kpi("Won leads",m.won.length,"closed pipeline")}
      ${kpi("Client count",m.customers.length,"current company")}
      ${kpi("Imports",FialhoDB.byCompany("imports").length,"CSV history")}
    </div>
    <section class="card" style="margin-top:14px">
      <div class="card-h"><h3>Revenue by service</h3><span class="sub">MVP report</span></div>
      <div class="card-b">${Object.entries(byService).map(([k,v]) => `<p><b>${escapeHtml(k)}</b> <span class="muted">${money(v)}</span></p>`).join("") || `<div class="empty">No revenue yet</div>`}</div>
    </section>`;
}

function renderImport(){
  const history = FialhoDB.byCompany("imports");
  const sheetUrl = db.integration_settings?.google_sheets?.source_urls?.[activeCompanyId] || "";
  $("#view").innerHTML = `
    <div class="grid two">
      <section class="card">
        <div class="card-h"><h3>CSV Import Center</h3><span class="sub">Imports into ${escapeHtml(company().name)} only</span></div>
        <div class="card-b">
          <div class="form-row">
            <div class="field"><label>Import source</label><select id="importType" onchange="importState.type=this.value;autoMap();importState.preview=[];renderImport()">${Object.entries(IMPORT_PRESETS).map(([k,p]) => `<option value="${k}" ${importState.type===k?"selected":""}>${p.label}</option>`).join("")}</select></div>
            <div class="field"><label>CSV, ICS, or Calendar ZIP file</label><input type="file" accept=".csv,.ics,.zip,text/csv,text/calendar,application/zip" onchange="loadImportFile(this.files[0])"></div>
          </div>
          <div class="field"><label>Google Sheets CSV URL</label><div class="inline-actions"><input id="sheetImportUrl" value="${escapeAttr(sheetUrl)}" placeholder="Paste Google Sheet URL or published CSV link"><button class="btn ghost" onclick="loadGoogleSheetCsv()">Load Sheet</button></div></div>
          ${importState.type === "calendar_ics" && importState.preview.length ? previewHtml() : importState.headers.length ? importMappingHtml() : `<div class="empty">Upload a CSV, Google Calendar .ics, or .ical.zip file to preview.</div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Import history</h3><span class="sub">${history.length} imports</span></div>
        <div class="card-b">
          ${history.map(h => `<p><b>${escapeHtml(h.file_name)}</b><br><span class="sub">${h.source_type} | ${h.created_count} created | ${h.updated_count} updated | ${h.skipped_count} skipped</span></p>`).join("") || `<div class="empty">No imports yet</div>`}
        </div>
      </section>
    </div>`;
}

async function loadGoogleSheetCsv(){
  const url = $("#sheetImportUrl")?.value.trim();
  if(!url){ toast("Paste a Google Sheet URL first."); return; }
  const csvUrl = toGoogleSheetCsvUrl(url);
  if(!csvUrl){ toast("Could not read that Google Sheet URL."); return; }
  try{
    importState.type = "sheets";
    db.integration_settings.google_sheets.source_urls = db.integration_settings.google_sheets.source_urls || {};
    db.integration_settings.google_sheets.source_urls[activeCompanyId] = url;
    FialhoDB.save();
    const response = await fetch(csvUrl);
    if(!response.ok) throw new Error("Sheet request failed");
    const text = await response.text();
    const parsed = parseCSV(text);
    importState.fileName = "Google Sheet import";
    importState.headers = (parsed[0] || []).map(h => h.trim());
    importState.rows = parsed.slice(1);
    importState.mapping = {};
    importState.preview = [];
    autoMap();
    renderImport();
    toast("Google Sheet loaded. Review mapping.");
  }catch(error){
    toast("Could not load Sheet. Publish it as CSV or share it publicly first.");
  }
}

function toGoogleSheetCsvUrl(url){
  if(!url) return "";
  if(url.includes("output=csv") || url.endsWith(".csv")) return url;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if(idMatch){
    const gid = (url.match(/[?&#]gid=(\d+)/) || [null,"0"])[1];
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
  }
  return url;
}

function importMappingHtml(){
  return `
    <div class="grid three">
      ${IMPORT_FIELDS.map(([field,label]) => `<div class="field"><label>${label}</label><select onchange="importState.mapping['${field}']=this.value;importState.preview=[];renderImport()">
        <option value="">Do not import</option>
        ${importState.headers.map(h => `<option value="${escapeAttr(h)}" ${importState.mapping[field]===h?"selected":""}>${escapeHtml(h)}</option>`).join("")}
      </select></div>`).join("")}
    </div>
    <button class="btn ghost" onclick="buildPreview()">Preview before saving</button>
    ${importState.preview.length ? previewHtml() : ""}`;
}

function previewHtml(){
  const counts = importState.preview.reduce((acc,row) => (acc[row.action]=(acc[row.action]||0)+1, acc),{});
  const isCalendarImport = importState.type === "calendar_ics";
  return `<div style="margin-top:16px">
    <div class="grid three">
      ${kpi("Create",counts.create || 0,"new records")}
      ${kpi("Update",counts.update || 0,"matched duplicates")}
      ${kpi("Skip",counts.skip || 0,"ignored rows")}
    </div>
    ${isCalendarImport ? calendarCleanupTools() : ""}
    <div class="table-wrap" style="margin-top:12px"><table>
      <thead><tr><th>Action</th>${isCalendarImport ? "<th>Company</th><th>Review</th>" : ""}<th>Name</th><th>Contact</th><th>Duplicate</th></tr></thead>
      <tbody>${importState.preview.slice(0,80).map((row,i) => `<tr>
        <td><select onchange="importState.preview[${i}].action=this.value;renderImport()">
          <option value="create" ${row.action==="create"?"selected":""}>Create new</option>
          <option value="update" ${row.action==="update"?"selected":""} ${row.duplicate?"":"disabled"}>Update existing</option>
          <option value="skip" ${row.action==="skip"?"selected":""}>Skip</option>
        </select></td>
        ${isCalendarImport ? `<td>${companySelectForImport(i,row.company_id || row.record.company_id || activeCompanyId)}</td>` : ""}
        ${isCalendarImport ? `<td><span class="pill">${escapeHtml(row.review_label || "job")}</span><br><span class="sub">${escapeHtml(row.review_reason || "Looks like work")}</span></td>` : ""}
        <td>${escapeHtml(row.kind === "job" ? row.record.title : row.record.name)}</td>
        <td>${escapeHtml(row.kind === "job" ? [row.record.scheduled_date,row.record.address,row.record.city].filter(Boolean).join(" | ") : row.record.phone || row.record.email || "")}</td>
        <td>${row.duplicate ? `${escapeHtml(row.duplicate.name || row.duplicate.title)} <span class="sub">${row.reasons.join(", ")}</span>` : `<span class="muted">No match</span>`}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <button class="btn" style="margin-top:12px" onclick="commitImport()">${isCalendarImport ? "Save calendar import" : `Save import to ${escapeHtml(company().name)}`}</button>
  </div>`;
}

function calendarCleanupTools(){
  const reviewCounts = importState.preview.reduce((acc,row) => {
    const label = row.review_label || "job";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  },{});
  return `<div class="empty" style="margin-top:12px">
    This PeachFresh calendar can contain jobs for multiple companies plus personal events. Review Company and Action before saving.
    <div class="inline-actions" style="margin-top:10px">
      <button class="btn ghost slim" onclick="applyCalendarCleanup('skip-personal')">Skip suggested personal</button>
      <button class="btn ghost slim" onclick="applyCalendarCleanup('skip-review')">Skip needs review</button>
      <button class="btn ghost slim" onclick="applyCalendarCleanup('restore-work')">Restore work suggestions</button>
    </div>
    <span class="sub">Suggested personal: ${reviewCounts.personal || 0} | Needs review: ${reviewCounts.review || 0} | Work-like: ${reviewCounts.job || 0}</span>
  </div>`;
}

function companySelectForImport(index,value){
  return `<select onchange="setImportRowCompany(${index},this.value)">
    ${COMPANIES.map(c => `<option value="${c.id}" ${value===c.id?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}
  </select>`;
}

function setImportRowCompany(index,companyId){
  const item = importState.preview[index];
  if(!item) return;
  item.company_id = companyId;
  item.record.company_id = companyId;
  item.duplicate = item.kind === "job" ? findDuplicateJob(item.record, companyId) : findDuplicate(item.record, companyId);
  item.reasons = item.duplicate?.reasons || [];
  item.action = item.duplicate ? "update" : "create";
  renderImport();
}

function applyCalendarCleanup(mode){
  importState.preview.forEach(item => {
    if(item.kind !== "job") return;
    if(mode === "skip-personal" && item.review_label === "personal") item.action = "skip";
    if(mode === "skip-review" && item.review_label === "review") item.action = "skip";
    if(mode === "restore-work" && item.review_label === "job") item.action = item.duplicate ? "update" : "create";
  });
  renderImport();
}

async function loadImportFile(file){
  if(!file) return;
  const name = file.name.toLowerCase();
  if(name.endsWith(".zip")){
    try{
      const text = await extractFirstIcsFromZip(await file.arrayBuffer());
      loadICS(text, file.name);
    }catch(error){
      toast("Could not read that ZIP. Upload the .ics file inside it.");
    }
    return;
  }
  if(name.endsWith(".ics") || file.type === "text/calendar"){
    const reader = new FileReader();
    reader.onload = e => loadICS(e.target.result, file.name);
    reader.readAsText(file);
    return;
  }
  loadCSV(file);
}

function loadCSV(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseCSV(e.target.result);
    importState.fileName = file.name;
    importState.headers = (parsed[0] || []).map(h => h.trim());
    importState.rows = parsed.slice(1);
    importState.mapping = {};
    importState.preview = [];
    autoMap();
    renderImport();
    toast("CSV loaded. Review mapping.");
  };
  reader.readAsText(file);
}

function loadICS(text,fileName){
  const events = parseICS(text);
  importState.type = "calendar_ics";
  importState.fileName = fileName || "Google Calendar ICS";
  importState.headers = [];
  importState.rows = [];
  importState.mapping = {};
  importState.recordType = "job";
  importState.preview = events.map((event,index) => {
    const record = jobFromIcsEvent(event);
    const companyId = record.company_id || activeCompanyId;
    const duplicate = findDuplicateJob(record, companyId);
    const review = classifyCalendarEvent(record, event);
    return {
      index, kind:"job", company_id:companyId, record, duplicate,
      reasons:duplicate?.reasons || [],
      review_label:review.label,
      review_reason:review.reason,
      action:review.skip ? "skip" : duplicate ? "update" : "create"
    };
  }).filter(row => row.record.title || row.record.scheduled_date || row.record.address);
  renderImport();
  toast(`${importState.preview.length} calendar events ready to preview.`);
}

async function extractFirstIcsFromZip(buffer){
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  for(const entry of zipEntries(view,buffer,decoder)){
    if(!entry.name.toLowerCase().endsWith(".ics")) continue;
    const localFileNameLength = view.getUint16(entry.offset + 26,true);
    const localExtraLength = view.getUint16(entry.offset + 28,true);
    const dataStart = entry.offset + 30 + localFileNameLength + localExtraLength;
    const data = buffer.slice(dataStart, dataStart + entry.compressedSize);
    if(entry.method === 0) return decoder.decode(data);
    if(entry.method === 8){
      if(!("DecompressionStream" in window)) throw new Error("ZIP decompression unavailable");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return decoder.decode(await new Response(stream).arrayBuffer());
    }
    throw new Error("Unsupported ZIP compression");
  }
  throw new Error("No .ics file found");
}

function zipEntries(view,buffer,decoder){
  const entries = [];
  for(let pos=0; pos < view.byteLength - 46; pos++){
    if(view.getUint32(pos,true) !== 0x02014b50) continue;
    const method = view.getUint16(pos + 10,true);
    const compressedSize = view.getUint32(pos + 20,true);
    const fileNameLength = view.getUint16(pos + 28,true);
    const extraLength = view.getUint16(pos + 30,true);
    const commentLength = view.getUint16(pos + 32,true);
    const offset = view.getUint32(pos + 42,true);
    const nameStart = pos + 46;
    const name = decoder.decode(buffer.slice(nameStart, nameStart + fileNameLength));
    entries.push({ name, method, compressedSize, offset });
    pos = nameStart + fileNameLength + extraLength + commentLength - 1;
  }
  if(entries.length) return entries;
  for(let pos=0; pos < view.byteLength - 30; pos++){
    if(view.getUint32(pos,true) !== 0x04034b50) continue;
    const method = view.getUint16(pos + 8,true);
    const compressedSize = view.getUint32(pos + 18,true);
    const fileNameLength = view.getUint16(pos + 26,true);
    const extraLength = view.getUint16(pos + 28,true);
    const nameStart = pos + 30;
    const name = decoder.decode(buffer.slice(nameStart, nameStart + fileNameLength));
    entries.push({ name, method, compressedSize, offset:pos });
    pos = nameStart + fileNameLength + extraLength + Math.max(compressedSize,0) - 1;
  }
  return entries;
}

function parseCSV(text){
  const rows = []; let row = [], cell = "", quoted = false;
  for(let i=0;i<text.length;i++){
    const char = text[i], next = text[i+1];
    if(quoted && char === '"' && next === '"'){ cell += '"'; i++; continue; }
    if(char === '"'){ quoted = !quoted; continue; }
    if(!quoted && char === ","){ row.push(cell); cell = ""; continue; }
    if(!quoted && (char === "\n" || char === "\r")){
      if(char === "\r" && next === "\n") i++;
      row.push(cell);
      if(row.some(v => v.trim())) rows.push(row);
      row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell);
  if(row.some(v => v.trim())) rows.push(row);
  return rows;
}

function parseICS(text){
  const unfolded = String(text || "").replace(/\r\n[ \t]/g,"").replace(/\n[ \t]/g,"");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  lines.forEach(line => {
    if(line === "BEGIN:VEVENT"){ current = {}; return; }
    if(line === "END:VEVENT"){ if(current) events.push(current); current = null; return; }
    if(!current) return;
    const split = line.indexOf(":");
    if(split < 0) return;
    const rawKey = line.slice(0,split);
    const key = rawKey.split(";")[0].toUpperCase();
    const value = decodeIcsValue(line.slice(split + 1));
    current[key] = current[key] ? `${current[key]}\n${value}` : value;
  });
  return events;
}

function decodeIcsValue(value){
  return String(value || "")
    .replace(/\\n/gi,"\n")
    .replace(/\\,/g,",")
    .replace(/\\;/g,";")
    .replace(/\\\\/g,"\\")
    .trim();
}

function jobFromIcsEvent(event){
  const parts = parseAddressParts(event.LOCATION || "");
  const title = event.SUMMARY || "Calendar event";
  const companyId = companyFromCalendarEvent(title, event.DESCRIPTION || "");
  return {
    company_id:companyId,
    source:"Google Calendar ICS",
    source_uid:event.UID || "",
    title,
    customer_name:customerNameFromTitle(title),
    status:event.STATUS?.toLowerCase() === "cancelled" ? "cancelled" : "scheduled",
    service_type:serviceFromTitle(title),
    scheduled_date:dateFromIcs(event.DTSTART),
    estimated_value:valueFromText(`${event.DESCRIPTION || ""}\n${title}`),
    address:parts.address,
    city:parts.city,
    state:parts.state,
    zip:parts.zip,
    notes:event.DESCRIPTION || "",
    lat:"",
    lng:"",
    drive_folder_url:""
  };
}

function classifyCalendarEvent(record,event){
  const text = normKey(`${record.title || ""} ${record.notes || ""} ${event.LOCATION || ""}`);
  const personalRules = [
    ["culto","Personal/church event"],
    ["walquiria","Personal/church event"],
    ["valquiria","Personal/church event"],
    ["valqu","Personal/church event"],
    ["marriage license","Personal document"],
    ["casamento","Personal event"],
    ["birthday","Birthday/personal"],
    ["christmas","Holiday"],
    ["thanksgiving","Holiday"],
    ["home office","Internal/admin, not customer job"],
    ["the home office","Internal/admin, not customer job"],
    ["cutting grass","Personal/home task"],
    ["camping","Personal event"],
    ["washer and dryer","Personal/home task"],
    ["reuniao planejamento financeiro","Personal/admin"],
    ["planejamento financeiro","Personal/admin"]
  ];
  if(text === "off") return { label:"personal", reason:"Time off", skip:true };
  const personal = personalRules.find(([needle]) => text === needle || text.includes(needle));
  if(personal) return { label:"personal", reason:personal[1], skip:true };
  if(!/[a-z0-9]/.test(text)) return { label:"personal", reason:"No usable job text", skip:true };

  const workSignals = [
    "clean","cleaning","carpet","rug","upholstery","cabinet","cabinets","kitchen","bathroom",
    "closet","install","installation","measurement","inspection","floor","flooring","tile",
    "drywall","mudroom","removal","client","yelp","peach fresh","wish cabinets","peach crafted"
  ];
  const hasWorkSignal = workSignals.some(signal => text.includes(signal));
  const hasJobDetails = Boolean(record.address || record.estimated_value || hasWorkSignal);
  if(!hasJobDetails) return { label:"review", reason:"No address/service/value found", skip:false };
  return { label:"job", reason:hasWorkSignal ? "Work keywords found" : "Has job details", skip:false };
}

function companyFromCalendarEvent(title,description){
  const text = normKey(`${title || ""} ${description || ""}`);
  if(/\barca\b/.test(text)) return "arca_cabinets";
  if(text.includes("floor") || text.includes("flooring") || text.includes("tile") || text.includes("carpet install")) return "peach_state_flooring";
  if(text.includes("cabinet") || text.includes("vanity") || text.includes("refacing") || text.includes("kitchen")) return "wish_cabinets";
  if(text.includes("clean") || text.includes("carpet") || text.includes("move in") || text.includes("move out") || text.includes("deep")) return "peach_fresh";
  return activeCompanyId || "peach_fresh";
}

function parseAddressParts(location){
  const parts = String(location || "").split(",").map(p => p.trim()).filter(Boolean);
  const stateZip = parts[2] || "";
  const match = stateZip.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  return {
    address:parts[0] || "",
    city:parts[1] || "",
    state:match?.[1] || "",
    zip:match?.[2] || normZip(location)
  };
}

function dateFromIcs(value){
  const raw = String(value || "").trim();
  if(/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  const normalized = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z");
  const date = new Date(normalized);
  if(Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function valueFromText(text){
  const dollar = String(text || "").match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  if(dollar) return Number(dollar[1].replace(/,/g,"")) || 0;
  const total = String(text || "").match(/\bTotal\s*-\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  return total ? Number(total[1].replace(/,/g,"")) || 0 : 0;
}

function serviceFromTitle(title){
  const normalized = normKey(title);
  return services().find(service => normalized.includes(normKey(service))) || services()[0] || "";
}

function customerNameFromTitle(title){
  return String(title || "").split(/\s+-\s+/)[0].trim();
}

function autoMap(){
  const presetAliases = IMPORT_PRESETS[importState.type]?.aliases || {};
  IMPORT_FIELDS.forEach(([field,label]) => {
    const aliases = [field,label,...(presetAliases[field] || [])].map(normKey);
    const match = importState.headers.find(h => aliases.some(a => normKey(h) === a || normKey(h).includes(a)));
    if(match) importState.mapping[field] = match;
  });
}

function mappedRecord(row){
  const record = { company_id:activeCompanyId, source:IMPORT_PRESETS[importState.type].label };
  Object.entries(importState.mapping).forEach(([field,header]) => {
    if(!header) return;
    const index = importState.headers.indexOf(header);
    record[field] = norm(row[index]);
  });
  if(!record.name && record.email) record.name = record.email.split("@")[0];
  record.zip = normZip(record.zip);
  record.stage_id = stageFromValue(record.stage_id || record.status);
  record.status = record.status || "active";
  record.value = Number(String(record.value || "0").replace(/[^0-9.]/g,"")) || 0;
  return record;
}

function stageFromValue(value){
  const v = normKey(value);
  if(v.includes("won") || v.includes("closed") || v.includes("complete")) return "won";
  if(v.includes("schedule") || v.includes("book")) return "scheduled";
  if(v.includes("estimate") || v.includes("quote")) return "estimate";
  if(v.includes("contact")) return "contacted";
  return "new";
}

function findDuplicate(record,companyId=activeCompanyId){
  const rows = (db.customers || []).filter(row => row.company_id === companyId);
  for(const existing of rows){
    const reasons = [];
    if(record.phone && normPhone(record.phone) && normPhone(record.phone) === normPhone(existing.phone)) reasons.push("phone");
    if(record.email && normEmail(record.email) && normEmail(record.email) === normEmail(existing.email)) reasons.push("email");
    if(record.address && normAddress(record.address) && normAddress(record.address) === normAddress(existing.address)) reasons.push("address");
    if(record.name && record.zip && normName(record.name) === normName(existing.name) && normZip(record.zip) === normZip(existing.zip)) reasons.push("name + ZIP");
    if(reasons.length) return { ...existing, reasons };
  }
  return null;
}

function findDuplicateJob(record,companyId=activeCompanyId){
  const rows = (db.jobs || []).filter(row => row.company_id === companyId);
  for(const existing of rows){
    const reasons = [];
    if(record.source_uid && existing.source_uid && record.source_uid === existing.source_uid) reasons.push("calendar UID");
    if(record.scheduled_date && existing.scheduled_date === record.scheduled_date && normName(record.title) === normName(existing.title)) reasons.push("title + date");
    if(record.scheduled_date && existing.scheduled_date === record.scheduled_date && record.address && normAddress(record.address) === normAddress(existing.address)) reasons.push("address + date");
    if(reasons.length) return { ...existing, reasons };
  }
  return null;
}

function buildPreview(){
  importState.preview = importState.rows.map((row,index) => {
    const record = mappedRecord(row);
    const duplicate = findDuplicate(record);
    return { index, record, duplicate, reasons:duplicate?.reasons || [], action:duplicate ? "update" : "create" };
  }).filter(r => r.record.name || r.record.phone || r.record.email || r.record.address);
  renderImport();
}

function commitImport(){
  let created = 0, updated = 0, skipped = 0;
  const importCompanyCounts = {};
  importState.preview.forEach(item => {
    if(item.action === "skip"){
      skipped++;
      if(item.kind === "job"){
        const companyId = item.company_id || item.record.company_id || activeCompanyId;
        importCompanyCounts[companyId] = importCompanyCounts[companyId] || { created:0, updated:0, skipped:0 };
        importCompanyCounts[companyId].skipped++;
      }
      return;
    }
    if(item.kind === "job"){
      const companyId = item.company_id || item.record.company_id || activeCompanyId;
      item.record.company_id = companyId;
      importCompanyCounts[companyId] = importCompanyCounts[companyId] || { created:0, updated:0, skipped:0 };
      if(item.action === "update" && item.duplicate){
        updateRecordForCompany("jobs", item.duplicate.id, companyId, cleanJob(item.record, companyId));
        updated++;
        importCompanyCounts[companyId].updated++;
        return;
      }
      const job = cleanJob(item.record, companyId);
      job.id = uid("job");
      job.created_at = now();
      job.updated_at = now();
      FialhoDB.insert("jobs", job);
      created++;
      importCompanyCounts[companyId].created++;
      return;
    }
    if(item.action === "update" && item.duplicate){
      FialhoDB.update("customers", item.duplicate.id, cleanCustomer(item.record));
      updated++; return;
    }
    const customer = cleanCustomer(item.record);
    customer.id = uid("cust");
    customer.created_at = now();
    customer.updated_at = now();
    FialhoDB.insert("customers", customer);
    FialhoDB.insert("leads", leadFromCustomer(customer));
    created++;
  });
  if(importState.type === "calendar_ics" && Object.keys(importCompanyCounts).length){
    Object.entries(importCompanyCounts).forEach(([companyId,counts]) => {
      FialhoDB.insert("imports", {
        id:uid("imp"), company_id:companyId, file_name:importState.fileName || "Calendar import",
        source_type:IMPORT_PRESETS[importState.type]?.label || "Google Calendar ICS", imported_at:now(),
        created_count:counts.created, updated_count:counts.updated, skipped_count:counts.skipped,
        row_count:counts.created + counts.updated + counts.skipped
      });
    });
  }else{
    FialhoDB.insert("imports", {
      id:uid("imp"), company_id:activeCompanyId, file_name:importState.fileName || "Import",
      source_type:IMPORT_PRESETS[importState.type]?.label || "Import", imported_at:now(),
      created_count:created, updated_count:updated, skipped_count:skipped, row_count:importState.preview.length
    });
  }
  importState = { type:"csv", fileName:"", headers:[], rows:[], mapping:{}, preview:[], recordType:"customer" };
  renderImport();
  toast(`${created} created, ${updated} updated, ${skipped} skipped.`);
}

function updateRecordForCompany(table,id,companyId,patch){
  const row = (db[table] || []).find(item => item.id === id && item.company_id === companyId);
  if(!row) return null;
  Object.assign(row, patch, { updated_at:now() });
  FialhoDB.save();
  return row;
}

function cleanJob(record,companyId=activeCompanyId){
  return {
    company_id:companyId,
    customer_id:record.customer_id || "",
    customer_name:record.customer_name || "",
    title:record.title || record.name || "Calendar event",
    status:record.status || "scheduled",
    service_type:record.service_type || (db.services?.[companyId] || [])[0] || "",
    scheduled_date:record.scheduled_date || "",
    estimated_value:Number(record.estimated_value || record.value || 0) || 0,
    address:record.address || "",
    city:record.city || "",
    state:record.state || "",
    zip:record.zip || "",
    notes:record.notes || "",
    source:record.source || "Manual",
    source_uid:record.source_uid || "",
    drive_folder_url:record.drive_folder_url || "",
    lat:Number(record.lat || 0) || "",
    lng:Number(record.lng || 0) || "",
    updated_at:now()
  };
}

function cleanCustomer(record,companyId=activeCompanyId){
  return {
    company_id:companyId,
    name:record.name || "Unnamed client",
    phone:record.phone || "",
    email:record.email || "",
    address:record.address || "",
    city:record.city || "",
    state:record.state || "",
    zip:record.zip || "",
    status:record.status || "active",
    service_type:record.service_type || services()[0] || "",
    source:record.source || "Manual",
    notes:record.notes || "",
    drive_folder_url:record.drive_folder_url || "",
    lat:Number(record.lat || 0) || "",
    lng:Number(record.lng || 0) || "",
    updated_at:now()
  };
}

function leadFromCustomer(customer){
  return {
    id:uid("lead"),
    company_id:activeCompanyId,
    customer_id:customer.id,
    name:customer.name,
    phone:customer.phone,
    email:customer.email,
    address:customer.address,
    city:customer.city,
    state:customer.state,
    zip:customer.zip,
    stage_id:"new",
    service_type:customer.service_type,
    value:0,
    source:customer.source,
    lat:customer.lat || "",
    lng:customer.lng || "",
    created_at:now(),
    updated_at:now()
  };
}

function upsertClientFromLead(lead,preferredClientId=""){
  const patch = cleanCustomer({
    ...lead,
    status:"active",
    source:lead.source || "Lead"
  }, activeCompanyId);
  if(preferredClientId){
    const existing = db.customers.find(customer => customer.id === preferredClientId && customer.company_id === activeCompanyId);
    if(existing){
      const merged = mergeClientData(existing, patch);
      FialhoDB.update("customers", existing.id, merged);
      return { ...existing, ...merged };
    }
  }
  const duplicate = findDuplicate(patch, activeCompanyId);
  if(duplicate){
    const merged = mergeClientData(duplicate, patch);
    FialhoDB.update("customers", duplicate.id, merged);
    return { ...duplicate, ...merged };
  }
  const client = {
    ...patch,
    id:uid("cust"),
    created_at:now(),
    updated_at:now()
  };
  FialhoDB.insert("customers", client);
  return client;
}

function upsertClientFromLeadRecord(lead,companyId){
  const patch = cleanCustomer({
    ...lead,
    status:"active",
    source:lead.source || "Lead"
  }, companyId);
  const duplicate = findDuplicate(patch, companyId);
  if(duplicate){
    const merged = mergeClientData(duplicate, patch);
    Object.assign(db.customers.find(client => client.id === duplicate.id && client.company_id === companyId), merged, { updated_at:now() });
    return { ...duplicate, ...merged };
  }
  const client = {
    ...patch,
    id:uid("cust"),
    created_at:lead.created_at || now(),
    updated_at:now()
  };
  db.customers.push(client);
  return client;
}

function mergeClientData(existing,patch){
  const merged = { ...patch };
  ["name","phone","email","address","city","state","zip","service_type","notes","drive_folder_url","lat","lng"].forEach(field => {
    if((merged[field] === "" || merged[field] == null) && existing[field]) merged[field] = existing[field];
  });
  merged.status = patch.status || existing.status || "active";
  merged.source = patch.source || existing.source || "Lead";
  return merged;
}

function openRecordModal(type,id){
  const record = id ? db[type === "job" ? "jobs" : `${type}s`].find(r => r.id === id && r.company_id === activeCompanyId) : null;
  const titleType = type === "customer" ? "client" : type;
  const title = `${id ? "Edit" : "New"} ${titleType}`;
  $("#modal-root").innerHTML = `<div class="modal-bg">
    <section class="modal">
      <div class="modal-h"><h3>${titleize(title)}</h3><button class="btn ghost slim" onclick="closeModal()">Close</button></div>
      <div class="modal-b">${recordForm(type,record || {})}</div>
      <div class="modal-f"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn" onclick="saveRecord('${type}','${id || ""}')">Save</button></div>
    </section>
  </div>`;
}

function recordForm(type,r = {}){
  r = r || {};
  if(type === "job"){
    const customers = FialhoDB.byCompany("customers");
    return `<div class="grid two">
      ${input("title","Job/project title",r.title || "")}
      <div class="field"><label>Client</label><select id="f_customer_id">${customers.map(c => `<option value="${c.id}" ${r.customer_id===c.id?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select></div>
      ${select("status","Status",["planned","scheduled","in progress","complete"],r.status || "planned")}
      ${select("service_type","Service",services(),r.service_type || services()[0])}
      ${input("scheduled_date","Scheduled date",r.scheduled_date || "","date")}
      ${input("estimated_value","Estimated value",r.estimated_value || "","number")}
      ${input("address","Address",r.address || "")}
      ${input("city","City",r.city || "")}
      ${input("state","State",r.state || "")}
      ${input("zip","ZIP",r.zip || "")}
      ${input("drive_folder_url","Google Drive folder URL",r.drive_folder_url || "")}
      ${input("lat","Latitude",r.lat || "","number")}
      ${input("lng","Longitude",r.lng || "","number")}
    </div>`;
  }
  return `<div class="grid two">
    ${input("name","Name",r.name || "")}
    ${input("phone","Phone",r.phone || "")}
    ${input("email","Email",r.email || "","email")}
    ${select("service_type","Service",services(),r.service_type || services()[0])}
    ${type === "lead" ? select("stage_id","Pipeline stage",stages().map(s => s.id),r.stage_id || "new",stages()) : select("status","Status",["active","past","lost"],r.status || "active")}
    ${type === "lead" ? input("value","Estimated value",r.value || "","number") : input("source","Source",r.source || "Manual")}
    ${input("address","Address",r.address || "")}
    ${input("city","City",r.city || "")}
    ${input("state","State",r.state || "")}
    ${input("zip","ZIP",r.zip || "")}
    ${type === "customer" ? input("drive_folder_url","Google Drive folder URL",r.drive_folder_url || "") : ""}
    ${input("lat","Latitude",r.lat || "","number")}
    ${input("lng","Longitude",r.lng || "","number")}
  </div>
  <div class="field"><label>Notes</label><textarea id="f_notes" rows="3">${escapeHtml(r.notes || "")}</textarea></div>`;
}

function input(id,label,value,type="text"){
  return `<div class="field"><label>${label}</label><input id="f_${id}" type="${type}" value="${escapeAttr(value)}"></div>`;
}

function select(id,label,options,value,stageOptions=null){
  return `<div class="field"><label>${label}</label><select id="f_${id}">
    ${options.map(opt => {
      const display = stageOptions ? stageOptions.find(s => s.id === opt)?.name : opt;
      return `<option value="${escapeAttr(opt)}" ${value===opt?"selected":""}>${escapeHtml(display || opt)}</option>`;
    }).join("")}
  </select></div>`;
}

function saveRecord(type,id){
  const table = type === "job" ? "jobs" : `${type}s`;
  const data = readForm(type);
  if(!data.name && !data.title){ toast("Name or title is required."); return; }
  if(id){
    if(type === "lead"){
      const existingLead = db.leads.find(lead => lead.id === id && lead.company_id === activeCompanyId);
      const client = upsertClientFromLead(data, existingLead?.customer_id);
      data.customer_id = client?.id || existingLead?.customer_id || "";
    }
    FialhoDB.update(table,id,data);
  }else{
    data.id = uid(type === "customer" ? "cust" : type);
    data.company_id = activeCompanyId;
    data.created_at = now();
    data.updated_at = now();
    if(type === "lead"){
      const client = upsertClientFromLead(data);
      data.customer_id = client?.id || "";
    }
    FialhoDB.insert(table,data);
  }
  closeModal();
  renderCurrent();
  toast("Record saved.");
}

function readForm(type){
  const data = {
    company_id:activeCompanyId,
    name:$("#f_name")?.value || "",
    phone:$("#f_phone")?.value || "",
    email:$("#f_email")?.value || "",
    address:$("#f_address")?.value || "",
    city:$("#f_city")?.value || "",
    state:$("#f_state")?.value || "",
    zip:$("#f_zip")?.value || "",
    service_type:$("#f_service_type")?.value || "",
    notes:$("#f_notes")?.value || "",
    drive_folder_url:$("#f_drive_folder_url")?.value || "",
    lat:Number($("#f_lat")?.value || 0) || "",
    lng:Number($("#f_lng")?.value || 0) || ""
  };
  if(type === "lead"){
    data.stage_id = $("#f_stage_id")?.value || "new";
    data.value = Number($("#f_value")?.value || 0);
    data.source = "Manual";
  }
  if(type === "customer"){
    data.status = $("#f_status")?.value || "active";
    data.source = $("#f_source")?.value || "Manual";
  }
  if(type === "job"){
    return {
      company_id:activeCompanyId,
      title:$("#f_title")?.value || "",
      customer_id:$("#f_customer_id")?.value || "",
      status:$("#f_status")?.value || "planned",
      service_type:$("#f_service_type")?.value || "",
      scheduled_date:$("#f_scheduled_date")?.value || "",
      estimated_value:Number($("#f_estimated_value")?.value || 0),
      address:data.address, city:data.city, state:data.state, zip:data.zip,
      drive_folder_url:data.drive_folder_url,
      lat:data.lat,
      lng:data.lng
    };
  }
  return data;
}

function closeModal(){
  const bg = $(".modal-bg");
  if(!bg){ $("#modal-root").innerHTML = ""; return; }
  bg.classList.add("closing");
  setTimeout(() => { $("#modal-root").innerHTML = ""; }, 160);
}
function driveRootLink(label){
  const url = db.integration_settings?.google_drive?.folder_urls?.[activeCompanyId];
  return url ? `<a href="${escapeAttr(url)}" target="_blank">${escapeHtml(label)}</a>` : `<span class="muted">Not linked</span>`;
}
function downloadText(filename,text,type="text/plain"){
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function toast(message){
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"),2200);
}

function titleize(value){
  return String(value).replace(/_/g," ").replace(/\b\w/g,c => c.toUpperCase());
}
function unique(values){
  return [...new Set(values)].sort((a,b) => String(a).localeCompare(String(b)));
}
function groupBy(rows,fn){
  return rows.reduce((acc,row) => {
    const key = fn(row);
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  },{});
}
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}
function escapeAttr(value){ return escapeHtml(value).replace(/'/g,"&#39;"); }

document.addEventListener("DOMContentLoaded", app);
