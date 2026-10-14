-- Quotes, built in the CRM after the visit and sent to the client as a PDF.
-- A deal can have several versions; each line is a catalog item (supplier
-- cost frozen when added) or a manual one (labor, countertop, delivery...).
-- Prices are computed from the cost with the quote's pricing method unless
-- a line sets its own price.

create table if not exists quotes (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  lead_id text references leads(id) on delete cascade,
  customer_id text references customers(id) on delete set null,
  version int not null default 1 check (version > 0),
  title text not null default '',
  door_line text not null default '',
  pricing_method text not null default 'margin' check (pricing_method in ('margin', 'markup')),
  pricing_pct numeric not null default 35 check (pricing_pct >= 0 and (pricing_method = 'markup' or pricing_pct < 100)),
  discount numeric not null default 0 check (discount >= 0),
  deposit_pct numeric not null default 0 check (deposit_pct >= 0 and deposit_pct <= 100),
  valid_days int not null default 30 check (valid_days > 0),
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft', 'sent')),
  cost_total numeric not null default 0,
  total numeric not null default 0,
  sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, version)
);

create table if not exists quote_items (
  id text primary key,
  quote_id text not null references quotes(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  position int not null default 0,
  section text not null default 'other',
  product_id uuid references supplier_products(id) on delete set null,
  sku text not null default '',
  description text not null default '',
  dimensions text not null default '',
  qty numeric not null default 1 check (qty > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  -- null = computed from unit_cost with the quote's pricing method
  unit_price numeric check (unit_price is null or unit_price >= 0),
  cost_category text not null default 'cabinets',
  created_at timestamptz not null default now()
);

create index if not exists quotes_lead_idx on quotes (lead_id);
create index if not exists quote_items_quote_idx on quote_items (quote_id, position);

alter table quotes enable row level security;
alter table quote_items enable row level security;

drop policy if exists quotes_member on quotes;
create policy quotes_member on quotes for all
  using (company_id in (select company_id from company_members where user_id = auth.uid()))
  with check (company_id in (select company_id from company_members where user_id = auth.uid()));

drop policy if exists quote_items_member on quote_items;
create policy quote_items_member on quote_items for all
  using (company_id in (select company_id from company_members where user_id = auth.uid()))
  with check (company_id in (select company_id from company_members where user_id = auth.uid()));
