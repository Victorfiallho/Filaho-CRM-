-- Stagnant-lead detection.
--
-- Adds a per-company staleness threshold and a lead_stage_history table that
-- records exactly when each lead entered/left each pipeline stage. This is
-- what "days in current stage" is measured from, instead of leads.updated_at
-- (which changes on ANY edit — address, phone, notes — not just a stage
-- move, so it's not a reliable proxy for stage dwell time).
--
-- Safe to re-run — create/alter guarded with if not exists, policies/
-- triggers/functions dropped and recreated.

alter table companies add column if not exists stale_lead_days integer not null default 14;

create table if not exists lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies(id) on delete cascade,
  lead_id text not null references leads(id) on delete cascade,
  stage_id text not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz
);
create index if not exists lead_stage_history_lead_idx on lead_stage_history(lead_id, exited_at);
create index if not exists lead_stage_history_open_idx on lead_stage_history(company_id, stage_id) where exited_at is null;

-- Keeps history in sync with leads.stage_id: opens the first row on insert,
-- and on update — only when stage_id actually changed — closes the
-- currently-open row and opens a new one. SECURITY DEFINER so it can write
-- regardless of which authenticated user triggers the leads change; RLS on
-- `leads` itself already governs whether that change is allowed at all, this
-- only mirrors the outcome, it never grants extra access to leads.
create or replace function track_lead_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_stage_history (company_id, lead_id, stage_id, entered_at)
    values (new.company_id, new.id, new.stage_id, coalesce(new.created_at, now()));
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    update lead_stage_history
      set exited_at = now()
      where lead_id = new.id and exited_at is null;
    insert into lead_stage_history (company_id, lead_id, stage_id, entered_at)
      values (new.company_id, new.id, new.stage_id, now());
  end if;
  return new;
end;
$$;

drop trigger if exists leads_track_stage_change on leads;
create trigger leads_track_stage_change
  after insert or update on leads
  for each row execute function track_lead_stage_change();

-- Backfill: one open history row per pre-existing lead, entered at
-- created_at — a best-effort starting point for leads that predate this
-- migration (their true stage-entry time before today isn't recoverable).
insert into lead_stage_history (company_id, lead_id, stage_id, entered_at)
select l.company_id, l.id, l.stage_id, l.created_at
from leads l
where not exists (select 1 from lead_stage_history h where h.lead_id = l.id);

alter table lead_stage_history enable row level security;
drop policy if exists lead_stage_history_select on lead_stage_history;
create policy lead_stage_history_select on lead_stage_history for select using (
  company_id in (select company_id from company_members where user_id = auth.uid())
);
-- No insert/update/delete policy for `authenticated` — only the SECURITY
-- DEFINER trigger above writes here, same shape as supplier_products'
-- service-role-only writes elsewhere in this schema.

-- RPC: leads open in their current (non-won/lost) stage longer than the
-- company's stale_lead_days. Plain `language sql` function defaults to
-- SECURITY INVOKER, so it runs as the calling `authenticated` role and
-- inherits the leads/lead_stage_history RLS policies above automatically —
-- no need to re-check company membership by hand.
create or replace function get_stagnant_leads(p_company_id text)
returns table (
  lead_id text,
  name text,
  stage_id text,
  value numeric,
  days_in_stage numeric
)
language sql
stable
as $$
  select
    l.id,
    l.name,
    l.stage_id,
    l.value,
    extract(epoch from (now() - h.entered_at)) / 86400.0 as days_in_stage
  from leads l
  join lead_stage_history h on h.lead_id = l.id and h.exited_at is null
  join companies c on c.id = l.company_id
  join pipeline_stages ps on ps.company_id = l.company_id and ps.id = l.stage_id
  where l.company_id = p_company_id
    and coalesce(ps.type, 'open') = 'open'
    and extract(epoch from (now() - h.entered_at)) / 86400.0 > c.stale_lead_days;
$$;
grant execute on function get_stagnant_leads(text) to authenticated;
