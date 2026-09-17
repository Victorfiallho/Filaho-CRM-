-- Project Costing & Financial Control — Phase 1 (schema + calculator core).
--
-- Every "project" here is an existing `jobs` row — this does NOT introduce a
-- parallel project entity. `project_financials` is a 1:1 extension of a job,
-- keyed by job_id, so a job with no matching row here simply has no costing
-- data yet (opt-in per project, existing jobs/customers/leads untouched).
--
-- Safe to re-run (create if not exists / drop policy if exists), same
-- convention as supabase/schema.sql and the 2026-08-31 migrations.

-- ── company_finance_settings (one row per company, global policy defaults) ─
create table if not exists company_finance_settings (
  company_id text primary key references companies(id) on delete cascade,
  default_minimum_margin_pct numeric not null default 35,
  default_deposit_pct numeric not null default 65,
  default_contingency_pct numeric not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── vendors (normalized supplier/payee list, per company) ────────────────
create table if not exists vendors (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  canonical_name text not null,
  aliases text[] not null default '{}'::text[],
  default_category text,
  location text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, canonical_name)
);
create index if not exists vendors_company_id_idx on vendors(company_id);

-- ── project_financials (1:1 with jobs — contract terms + margin policy) ──
create table if not exists project_financials (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  job_id text not null unique references jobs(id) on delete cascade,
  original_contract_value numeric not null default 0,
  discounts numeric not null default 0,
  customer_fees numeric not null default 0,
  -- null falls back to company_finance_settings.default_minimum_margin_pct —
  -- an explicit override here is the "authorized adjustment per project"
  -- the spec asks for (item 2: "possibilidade de ajuste autorizado por projeto").
  minimum_margin_pct numeric,
  desired_margin_pct numeric,
  minimum_profit_usd numeric,
  contingency_pct numeric,
  deposit_pct numeric not null default 65,
  -- e.g. [{"label":"Deposit","pct":65},{"label":"Progress","pct":25},{"label":"Final","pct":10}]
  deposit_schedule jsonb not null default '[]'::jsonb,
  -- Manual until Phase 2's transactions ledger exists — once that ships,
  -- the app switches to summing confirmed customer-payment transactions and
  -- this column becomes a fallback only (kept, never dropped, for projects
  -- that never get a single ledger entry).
  payments_received_manual numeric not null default 0,
  start_date date,
  target_completion_date date,
  profit_release_stage text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_financials_company_id_idx on project_financials(company_id);

-- ── change_orders (affects Contract Revenue when approved) ───────────────
create table if not exists change_orders (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  description text not null default '',
  amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists change_orders_job_id_idx on change_orders(job_id);

-- ── cost_line_items (the project's cost budget/actuals, one row per item) ─
create table if not exists cost_line_items (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  category text not null check (category in (
    'materials', 'subcontractor_labor', 'employee_labor', 'owner_labor',
    'plumbing', 'electrical', 'countertop', 'cabinets', 'flooring',
    'tile_backsplash', 'painting', 'cleaning', 'delivery_freight',
    'equipment_rental', 'tools_consumables', 'permits_fees', 'disposal',
    'fuel_mileage', 'payment_processing_fees', 'contingency', 'other'
  )),
  description text not null default '',
  vendor_id text references vendors(id) on delete set null,
  estimated_cost numeric not null default 0,
  quoted_to_customer numeric not null default 0,
  committed_amount numeric not null default 0,
  actual_paid numeric not null default 0,
  -- Notional cost of owner/unpaid labor (e.g. Pedro doing plumbing himself)
  -- for true-profitability math even when no real cash left the business —
  -- see the spec's "Owner labor deve possuir um custo interno" rule. Kept
  -- separate from actual_paid so cash-flow numbers never double-count it.
  internal_cost numeric not null default 0,
  tax numeric not null default 0,
  freight numeric not null default 0,
  discount numeric not null default 0,
  returned_amount numeric not null default 0,
  net_cost numeric generated always as (actual_paid + tax + freight - discount - returned_amount) stored,
  expected_date date,
  purchase_date date,
  payment_method text default '',
  status text not null default 'planned' check (status in (
    'planned', 'quoted', 'approved', 'ordered', 'committed', 'partially_paid',
    'paid', 'returned', 'partially_refunded', 'fully_refunded', 'canceled'
  )),
  responsible_user_id text references users(id) on delete set null,
  -- FK to `receipts` added in the Phase 4 migration once that table exists —
  -- kept as a plain text column now so this table doesn't need reshaping later.
  receipt_id text,
  notes text default '',
  -- Defaults to the inserting user rather than requiring every data/*.ts
  -- call site to look up and pass its own session — auth.uid() is already
  -- available in the RLS context of every authenticated insert.
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cost_line_items_job_id_idx on cost_line_items(job_id);
create index if not exists cost_line_items_company_id_idx on cost_line_items(company_id);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — same company-membership pattern as every other operational table.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'company_finance_settings', 'vendors', 'project_financials',
    'change_orders', 'cost_line_items'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert with check (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       ) with check (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for delete using (
         company_id in (select company_id from company_members where user_id = auth.uid())
       )', t || '_delete', t);
  end loop;
end $$;

-- Pin company_id immutable after creation (same rationale/trigger as
-- schema.sql's pin_company_id — a user in two companies must never be able
-- to move a financial row from one tenant to the other via a crafted PATCH).
do $$
declare t text;
begin
  foreach t in array array[
    'company_finance_settings', 'vendors', 'project_financials',
    'change_orders', 'cost_line_items'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_pin_company', t);
    execute format(
      'create trigger %I before update on %I for each row execute function pin_company_id()',
      t || '_pin_company', t);
  end loop;
end $$;

-- Audit trail — reuse the existing generic record_audit_log() trigger
-- (supabase/migrations/2026-08-31_04_audit_log.sql) instead of building a
-- parallel logging mechanism. Financial edits land in the same audit_log
-- table/UI the rest of the app already has.
do $$
declare t text;
begin
  foreach t in array array['project_financials', 'change_orders', 'cost_line_items'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit_log', t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function record_audit_log(%L)',
      t || '_audit_log', t, t);
  end loop;
end $$;
