-- Project Costing & Financial Control — Phase 2 (ledger + refunds + profit
-- releases). Additive only, same safe-to-re-run convention as every prior
-- migration in this folder.
--
-- Relationship to Phase 1's `cost_line_items`: that table stays the
-- authoritative source for project cost/margin math (unchanged by this
-- migration). `transactions` is a separate, formal money-movement ledger —
-- confirmed customer-payment transactions become the source of truth for a
-- project's "amount received" (superseding project_financials.
-- payments_received_manual once any exist for that job), and the ledger
-- feeds the company-wide dashboard (payroll, owner draws, vendor spend).
-- Reconciling "this receipt created both a transaction AND a cost_line_item"
-- automatically is Phase 4's job (receipt approval), not this one.

-- ── transactions (the financial ledger) ──────────────────────────────────
create table if not exists transactions (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  client_id text references customers(id) on delete set null,
  -- Nullable: company-level entries (e.g. an owner draw not tied to one job)
  -- are valid per spec section 6.
  job_id text references jobs(id) on delete set null,
  transaction_type text not null check (transaction_type in (
    'customer_deposit', 'progress_payment', 'final_payment', 'change_order_payment',
    'material_purchase', 'labor_payment', 'subcontractor_payment', 'employee_payment',
    'owner_labor_payment', 'vendor_refund', 'vendor_credit', 'customer_refund',
    'processing_fee', 'reimbursement', 'owner_draw', 'transfer', 'adjustment',
    'other_income', 'other_expense'
  )),
  category text default '',
  vendor_id text references vendors(id) on delete set null,
  payee_name text default '',
  description text default '',
  transaction_date date not null default current_date,
  due_date date,
  amount numeric not null default 0,
  sales_tax numeric not null default 0,
  payment_method text default '',
  account text default '',
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  receipt_id text,
  -- Self-reference for the adjustment/reversal flow: a confirmed transaction
  -- is never edited/deleted (enforced by the trigger below) — correcting one
  -- means inserting a new row with reversal_of pointing back at it, so the
  -- original stays in the audit trail per spec section 6.
  reversal_of text references transactions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transactions_company_id_idx on transactions(company_id);
create index if not exists transactions_job_id_idx on transactions(job_id);
create index if not exists transactions_client_id_idx on transactions(client_id);

-- Confirmed transactions are immutable on every financially-meaningful
-- field — draft rows can still be edited/deleted freely by the app (no
-- trigger blocks that). Notes/receipt/approved_by/due_date/payment_method
-- stay editable even after confirmation since they don't change the money.
create or replace function lock_confirmed_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'confirmed' then
    if new.amount is distinct from old.amount
       or new.sales_tax is distinct from old.sales_tax
       or new.transaction_type is distinct from old.transaction_type
       or new.job_id is distinct from old.job_id
       or new.client_id is distinct from old.client_id
       or new.company_id is distinct from old.company_id
       or (new.status is distinct from old.status) then
      raise exception 'Confirmed transactions cannot be edited or un-confirmed — create an adjustment/reversal instead.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_lock_confirmed on transactions;
create trigger transactions_lock_confirmed before update on transactions for each row execute function lock_confirmed_transaction();

-- ── refunds (linked to the original cost line item and/or transaction) ───
create table if not exists refunds (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  cost_line_item_id text references cost_line_items(id) on delete set null,
  transaction_id text references transactions(id) on delete set null,
  description text default '',
  amount numeric not null default 0,
  status text not null default 'expected' check (status in ('expected', 'submitted', 'processing', 'received', 'denied')),
  expected_date date,
  received_date date,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_job_id_idx on refunds(job_id);

-- ── profit_releases (append-only history of partial profit withdrawals) ──
create table if not exists profit_releases (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  amount numeric not null default 0,
  released_by uuid references auth.users(id) on delete set null default auth.uid(),
  released_at timestamptz not null default now(),
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists profit_releases_job_id_idx on profit_releases(job_id);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS — same company-membership pattern as every other table.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['transactions', 'refunds', 'profit_releases'] loop
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

do $$
declare t text;
begin
  foreach t in array array['transactions', 'refunds', 'profit_releases'] loop
    execute format('drop trigger if exists %I on %I', t || '_pin_company', t);
    execute format(
      'create trigger %I before update on %I for each row execute function pin_company_id()',
      t || '_pin_company', t);
  end loop;
end $$;

-- Audit trail via the existing generic trigger (same as Phase 1's tables).
do $$
declare t text;
begin
  foreach t in array array['transactions', 'refunds', 'profit_releases'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit_log', t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function record_audit_log(%L)',
      t || '_audit_log', t, t);
  end loop;
end $$;
